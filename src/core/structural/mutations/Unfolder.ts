import { createRequire } from "node:module";
import path from "node:path";
import { DOPAT_CONFIG } from "@config";
import { SystemRef } from "@core_i/System";
import type Store from "@core_s/Memory";
import { metrics } from "@core_s/Metrics";
import type { GridIndex4D } from "@mutate/GridIndex4D";
import { computeCurvature } from "@props/Curvature";
import { random } from "@utils/seededRandom";
import { extractTriples } from "@utils/tripleExtract";
import axios from "axios";
import wiki from "wikipedia";

// Wikipedia API requires a valid User-Agent to avoid 403 Forbidden errors.
axios.defaults.headers.common["User-Agent"] =
  "MpatLogicEngine/1.0 (https://github.com/dopecodez/Wikipedia/)";

interface CTX7_SearchResult {
  id: string;
  title: string;
  description: string;
  branch: string;
  lastUpdateDate: string;
  state: string;
  totalTokens: number;
  totalSnippets: number;
  stars: number;
  trustScore: number;
  benchmarkScore: number;
  versions: string[];
}
interface CTX7_SearchResponse {
  results: CTX7_SearchResult[];
}
interface CTX7_CodeSnippet {
  codeTitle: string;
  codeDescription: string;
  codeLanguage: string;
  codeTokens: number;
  codeId: string;
  pageTitle: string;
  codeList: [{ language: string; code: string }];
}
interface CTX7_InfoSnippet {
  pageId: string;
  breadcrumb: string;
  content: string;
  contentTokens: number;
}
interface CTX7_ContextResponse {
  codeSnippets: CTX7_CodeSnippet[];
  infoSnippets: CTX7_InfoSnippet[];
}

// DictionaryExpander
// WordNet-based local expansion: fast, offline, no network.  Tried first inside
// Unfolder.expand(); Wikipedia / Context7 is the fallback when the word is not
// in the dictionary or produces no useful cluster.

function resolveWordNetPath(): string {
  const req = createRequire(import.meta.url);
  const wnPkg = req.resolve("en-wordnet/package.json");
  return path.join(path.dirname(wnPkg), "database", "3.1");
}

export interface DictionaryExpansion {
  found: boolean;
  word: string;
  definitions: string[];
  synonyms: string[];
}

/**
 * Wraps WordNet (via en-dictionary) to cluster unknown words by their
 * definitions and synonyms.  Ingests facts into the manifold so future
 * resonance passes can traverse the semantic cluster.
 */
export class DictionaryExpander {
  private dict: import("en-dictionary").default | null = null;
  private readonly initPromise: Promise<void>;

  constructor() {
    this.initPromise = this._init();
  }

  private async _init(): Promise<void> {
    try {
      const { default: Dictionary } = await import("en-dictionary");
      this.dict = new Dictionary(resolveWordNetPath());
      await this.dict.init();
    } catch {
      // Dictionary is optional; Unfolder falls back to Wikipedia when unavailable.
    }
  }

  public get isReady(): boolean {
    return this.dict !== null;
  }

  public async waitForInit(): Promise<void> {
    return this.initPromise;
  }

  public async expand(
    word: string,
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store?: Store
  ): Promise<DictionaryExpansion> {
    const result: DictionaryExpansion = {
      found: false,
      word,
      definitions: [],
      synonyms: [],
    };
    if (!this.dict) return result;

    const norm = word.toLowerCase().trim().replace(/\s+/g, "_");
    if (norm.length < 2) return result;

    let searchResult: Map<string, Map<string, any>>;
    try {
      searchResult = this.dict.searchFor([norm]);
    } catch {
      return result;
    }

    const posEntries = searchResult.get(norm);
    if (!posEntries?.size) return result;

    for (const [, entry] of posEntries) {
      for (const data of entry?.offsetData ?? []) {
        const def = data.glossary?.[0]
          ?.replace(/["']/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (def && !result.definitions.includes(def))
          result.definitions.push(def);

        for (const ptr of data.pointers ?? []) {
          if (
            ptr.offset === 0 &&
            typeof ptr.symbol === "string" &&
            /^[a-z][a-z\-_ ]*$/i.test(ptr.symbol) &&
            ptr.symbol.toLowerCase() !== norm
          ) {
            const syn = ptr.symbol.replace(/_/g, " ").toLowerCase();
            if (!result.synonyms.includes(syn)) result.synonyms.push(syn);
          }
        }
      }
    }

    if (!result.definitions.length && !result.synonyms.length) return result;
    result.found = true;

    const seen = new Set<string>();
    const wordStr = norm.replace(/_/g, " ");

    // G7 fix: crystallize word→definition and word→synonym as (input, output)
    // pairs rather than (ids, ids) self-loops.  The input is the word; the
    // output is the definition / synonym.  This lets Phase 0b vault recall map
    // "word |-" to its meaning, instead of storing a VAR_0 → VAR_0 no-op.
    const wordIds = atomizer.ingestSequence(wordStr, system);

    for (const def of result.definitions.slice(0, 3)) {
      const defText = def.split(" ").slice(0, 8).join(" ");
      const key = `${wordStr}>${defText}`;
      if (!seen.has(key)) {
        seen.add(key);
        const defIds = atomizer.ingestSequence(defText, system);
        if (store) await store.crystallizeProof(wordIds, defIds, 0.8);
      }
    }

    for (const syn of result.synonyms.slice(0, 6)) {
      const key = `${wordStr}>${syn}`;
      if (!seen.has(key)) {
        seen.add(key);
        const synIds = atomizer.ingestSequence(syn, system);
        if (store) await store.crystallizeProof(wordIds, synIds, 0.9);
      }
    }

    return result;
  }
}

// Unfolder sources

export interface SearchResult {
  title?: string;
  link?: string;
  url?: string;
  snippet?: string;
  source?: string;
  text?: string;
}

/** Thrown when an external fetch exceeds UNFOLDER_FETCH_TIMEOUT_MS. */
export class UnfolderTimeoutError extends Error {
  constructor(topic: string) {
    super(
      `Unfolder fetch timed out after ${DOPAT_CONFIG.structural.UNFOLDER_FETCH_TIMEOUT_MS}ms: ${topic}`
    );
    this.name = "UnfolderTimeoutError";
  }
}

/**
 * Races `promise` against a timeout. On expiry, rejects with UnfolderTimeoutError.
 * The timer is always cleared regardless of which branch wins.
 */
function withTimeout<T>(promise: Promise<T>, topic: string): Promise<T> {
  const ms = DOPAT_CONFIG.structural.UNFOLDER_FETCH_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UnfolderTimeoutError(topic)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * The Unfolder is responsible for identifying "Logical Voids"
 * (areas with low density/information) and filling them by harvesting
 * data from external sources like Context7 technical docs or Wikipedia.
 */
export default class Unfolder {
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  private atomizer: Atomic.Engine;
  private expandCount: number = 0;
  /** Local dictionary: tried first in expand() before any network fetch. */
  public readonly dictionary = new DictionaryExpander();
  /**
   * Raw prose fetched during the most recent network expansion (Wikipedia / Context7).
   * Empty when the last expansion was served by the local dictionary.
   * Listener uses this to extract a coherent sentence for immediate response,
   * while the ingested tokens build long-term manifold topology in parallel.
   */
  public lastFetchedContent: string = "";
  /**
   * Optional delta sink. When set (by ManifoldLifecycle.setUnfolder()), expand()
   * posts a Delta.Ingest instead of writing to the manifold directly - ensuring
   * all mutations go through the single-writer tick-drain path.
   */
  private onDelta: ((delta: Delta.Any) => void) | null = null;

  /**
   * Optional wiki fetch delegate.  When set (by Runtime.boot() via WorkerPool),
   * queryWikipedia() is routed through the isolated wiki worker instead of
   * running in the main thread.
   */
  private wikiDelegate: ((topic: string) => Promise<string | null>) | null =
    null;

  constructor(system: Root.ManifoldView | SystemRef, atomizer: Atomic.Engine) {
    this.systemRef =
      system instanceof SystemRef ? system : new SystemRef(system);
    this.atomizer = atomizer;
  }

  /** Wire a delta sink so expand() posts through the DeltaQueue. */
  public setDeltaSink(sink: (delta: Delta.Any) => void): void {
    this.onDelta = sink;
  }

  /** Route Wikipedia fetches through an external delegate (e.g., wiki worker). */
  public setWikiDelegate(fn: (topic: string) => Promise<string | null>): void {
    this.wikiDelegate = fn;
  }

  /**
   * Performs a fractal expansion of a logical void.
   *
   * When a delta sink is wired (via setDeltaSink), mutations are posted as
   * Delta.Ingest records and applied during the next tick(). Otherwise falls
   * back to direct manifold writes for standalone / test usage.
   */
  public async expand(
    voidPreceptId: number,
    topic?: string,
    store?: Store
  ): Promise<boolean> {
    const activeTopic =
      topic ||
      this.atomizer
        .decodeSequence(new Uint32Array([voidPreceptId]), this.system)
        .trim();

    // Fast path: local WordNet dictionary (offline, ~milliseconds).
    if (this.dictionary.isReady) {
      const dictResult = await this.dictionary.expand(
        activeTopic,
        this.system,
        this.atomizer,
        store
      );
      if (dictResult.found) return true;
    }

    // Slow path: Wikipedia / Context7 (network, seconds).
    const fullContent = await this.fetchContent(activeTopic);
    if (!fullContent) return false;
    this.lastFetchedContent = fullContent;

    const basePosX = this.system.posX[voidPreceptId];
    const basePosY = this.system.posY[voidPreceptId];
    const factDisplacementZ = (this.expandCount + 1) * 10.0;
    this.expandCount++;

    // Route through the DeltaQueue when wired, so tick() is the sole writer.
    if (this.onDelta) {
      this.onDelta({
        kind: "ingest",
        text: fullContent,
        basePosX,
        basePosY,
        factDisplacementZ,
      });
      return true;
    }

    // Fallback: direct manifold write (standalone / tests without ManifoldLifecycle).
    const newPreceptIds = this.ingestContent(fullContent);
    if (newPreceptIds.length === 0) return false;

    const jitterRange = DOPAT_CONFIG.structural.DREAM_POS_X_JITTER;

    for (const id of Array.from(newPreceptIds)) {
      this.system.mass[id] = this.system.c * 10;

      // Concept-centroid posX with small jitter: keeps dreamt facts near their parent
      // concept for geodesic reachability while giving each fact a distinct position
      // so semantic diversity is not collapsed to a single coordinate.
      const jitter = (random() - 0.5) * jitterRange;
      this.system.posX[id] = basePosX + jitter;
      this.system.posY[id] = this.system.posY[id] + basePosY;
      this.system.posZ[id] = this.system.posZ[id] + factDisplacementZ;
      this.system.update(id);
    }

    return true;
  }

  /**
   * Fetches raw text content for a topic from Wikipedia or Context7.
   * Returns empty string when unavailable; never throws.
   */
  public async fetchContent(topic: string): Promise<string> {
    const isCodeRelated =
      /api|code|function|programming|library|framework|script|typescript|javascript|python|rust|c\+\+|java|ruby|go|php|swift|kotlin|scala|sql|html|css|react|vue|angular|node|express|django|flask|spring|rails|laravel|dotnet|kubernetes|docker|aws|gcp|azure|linux|macos|windows|android|ios/i.test(
        topic
      );

    if (isCodeRelated) {
      const technicalData = await this.queryContext7(topic);
      if (technicalData) {
        return `${technicalData.title}. ${technicalData.snippet}`.trim();
      }
    } else {
      const wikiData = await this.queryWikipedia(topic);
      if (wikiData) {
        return wikiData.trim();
      }
    }
    // S13: log the miss so Phase 5 callers have a trace rather than silently degrading.
    metrics.increment("unfolder.fetch_miss");
    return "";
  }

  /**
   * Ingests text into the manifold sentence-by-sentence.
   *
   * Each sentence is a separate ingestSequence call so it forms its own
   * PartLayer chain.  Crucially, each sentence's atoms are tagged with an
   * incremental posZ offset (sentence 0 → +0, sentence 1 → +1, ...) on top
   * of whatever factDisplacementZ the caller adds later.
   *
   * This gives the expanded content a causal Z-axis structure: the Mapper's
   * geodesic naturally traverses sentences in layer order, producing a
   * coherent step-by-step sequence rather than a word-salad blob.
   */
  public ingestContent(text: string, system?: Root.ManifoldView): Uint32Array {
    const sys = system ?? this.systemRef.current;
    // S14 fix: score sentences by information density before capping at 30.
    // This prevents technical content (where the key fact is mid-document)
    // from being truncated in favour of preamble sentences.
    // Score = word count × (1 + noun/verb density heuristic).
    const allSentences = text
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 8);

    const scored = allSentences.map((s, i) => {
      const words = s.split(/\s+/);
      // Prefer sentences with more words (information-dense).
      let score = Math.min(words.length, 30);
      // Boost sentences that contain predicate-like tokens (is/are/was/=).
      if (/\b(is|are|was|were|=|:)\b/.test(s)) score += 5;
      // Lead sentences (first 5) get a modest boost (usually topic introductions).
      if (i < 5) score += 3;
      return { s, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const sentences = scored.slice(0, 30).map(x => x.s);

    if (sentences.length <= 1) {
      return this.atomizer.ingestSequence(text, sys);
    }

    const allIds: number[] = [];
    for (let s = 0; s < sentences.length; s++) {
      // Try triple extraction first - SVO structure produces better manifold topology
      // than raw prose.  Fall back to the raw sentence if no triples are found.
      const triples = extractTriples(sentences[s]);
      const seqs =
        triples.length > 0
          ? triples.map(t => `${t.subject} ${t.predicate} ${t.object}`)
          : [sentences[s]];

      for (const seq of seqs) {
        const ids = this.atomizer.ingestSequence(seq, sys);
        // Tag each atom's posZ so Math.floor(posZ) == sentence index s.
        // The atomizer sets posZ = depth (a small float from inheritance).
        // Using "+= s" made floor(depth + s) unstable when depth ≥ 1.
        // Instead: set the INTEGER part to s and keep the FRACTIONAL depth so
        // atoms in the same sentence always group under the same floor key.
        for (const id of ids) {
          sys.posZ[id] = s + (sys.posZ[id] % 1);
          sys.update(id);
          allIds.push(id);
        }
      }
    }
    return new Uint32Array(allIds);
  }

  /**
   * Resolves a scope hash back to its original token string.
   */
  public resolveScope(scope: number): string | undefined {
    return this.atomizer.resolveScope(scope);
  }

  /**
   * C2 - Rank allocated atoms by absolute scalar curvature |R|, descending.
   *
   * High-curvature zones are under-resolved: the manifold's geometry deviates
   * most from flat Euclidean space there, so expansion effort is highest-value.
   * The dreamCycle uses this ranking instead of random/tension-zone selection.
   *
   * @param gridIndex - Spatial index of the current manifold (built by caller).
   * @param topK      - Maximum candidates to return (default 200).
   */
  public rankExpansionCandidates(
    gridIndex: GridIndex4D,
    topK = 200
  ): Array<{ id: number; absR: number }> {
    const sys = this.systemRef.current;
    const candidates: Array<{ id: number; absR: number }> = [];

    for (let i = 0; i < sys.length; i++) {
      if (!sys.isAllocated(i)) continue;
      const { R } = computeCurvature(
        sys,
        gridIndex,
        sys.posX[i],
        sys.posY[i],
        sys.posZ[i],
        sys.posW[i]
      );
      candidates.push({ id: i, absR: Math.abs(R) });
    }

    candidates.sort((a, b) => b.absR - a.absR);
    return candidates.slice(0, topK);
  }

  /** Fetches encyclopedic context from Wikipedia with a hard timeout. */
  private async queryWikipedia(topic: string): Promise<string | null> {
    // If a wiki worker is wired, delegate to it (isolated heap, no main-thread GC).
    if (this.wikiDelegate) {
      try {
        return await this.wikiDelegate(topic);
      } catch {
        return null;
      }
    }

    // Fallback: fetch in-process (used in tests / standalone mode).
    const CHAR_CAP = 6000;
    try {
      const content = await withTimeout(
        wiki.page(topic).then(p => p.content()),
        topic
      );
      return content.slice(0, CHAR_CAP).replace(/\n+/g, " ").trim() || null;
    } catch (e) {
      if (e instanceof UnfolderTimeoutError) {
        metrics.increment("dream.rejected_timeout");
      } else {
        console.log("Error querying Wikipedia: ", e);
      }
      return null;
    }
  }

  /** Queries Context7 technical data with a hard timeout and no synthetic fallback. */
  private async queryContext7(
    query: string,
    libname?: string
  ): Promise<SearchResult | null> {
    const apiKey = process.env.CONTEXT7_API_KEY || "YOUR_CONTEXT7_API_KEY_HERE";
    const ms = DOPAT_CONFIG.structural.UNFOLDER_FETCH_TIMEOUT_MS;

    try {
      const makeController = () => {
        const c = new AbortController();
        const t = setTimeout(() => c.abort(), ms);
        return { signal: c.signal, clear: () => clearTimeout(t) };
      };

      let lib_id = "/microsoft/typescript";
      const libCtrl = makeController();
      try {
        const libs = await fetch(
          `https://context7.com/api/v2/libs/search?libraryName=${libname}&query=${query}`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: libCtrl.signal,
          }
        );
        if (libs.ok) {
          const lib_data = await libs.json();
          lib_id =
            (lib_data as CTX7_SearchResponse).results?.[0]?.id ?? "typescript";
        } else {
          console.warn(`Context7 API returned status: ${libs.status}`);
        }
      } finally {
        libCtrl.clear();
      }

      const ctxCtrl = makeController();
      try {
        const context = await fetch(
          `https://context7.com/api/v2/context?libraryId=${lib_id}&query=${query}&type=json`,
          {
            method: "GET",
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: ctxCtrl.signal,
          }
        );

        if (!context.ok) {
          console.warn(`Context7 API returned status: ${context.status}`);
          return null;
        }

        const data = await context.json();
        const response = data as CTX7_ContextResponse;
        if (response.codeSnippets?.length > 0) {
          return {
            title:
              response.codeSnippets[0].codeTitle ||
              response.codeSnippets[0].pageTitle ||
              "Context7",
            url: response.codeSnippets[0].codeId || "https://context7.com/docs",
            snippet: response.codeSnippets[0].codeList[0].code || "",
            text: response.infoSnippets[0]?.content || "",
          };
        }
      } finally {
        ctxCtrl.clear();
      }

      return null;
    } catch (e: any) {
      if (e?.name === "AbortError") {
        metrics.increment("dream.rejected_timeout");
      } else {
        metrics.increment("dream.context7_error");
        console.log("Error querying Context7: ", e);
      }
      return null;
    }
  }
}
