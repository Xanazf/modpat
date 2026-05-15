import type System from "@core_i/System";
import { SystemRef } from "@core_i/System";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import { metrics } from "@core_s/Metrics";
import { DOPAT_CONFIG } from "@config";
import wiki from "wikipedia";
import axios from "axios";

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
  private atomizer: SemanticAtomizer;
  private expandCount: number = 0;
  /**
   * Optional delta sink. When set (by ManifoldManager.setUnfolder()), expand()
   * posts a Delta.Ingest instead of writing to the manifold directly — ensuring
   * all mutations go through the single-writer tick-drain path.
   */
  private onDelta: ((delta: Delta.Any) => void) | null = null;

  constructor(system: System | SystemRef, atomizer: SemanticAtomizer) {
    this.systemRef =
      system instanceof SystemRef ? system : new SystemRef(system);
    this.atomizer = atomizer;
  }

  /** Wire a delta sink so expand() posts through the DeltaQueue. */
  public setDeltaSink(sink: (delta: Delta.Any) => void): void {
    this.onDelta = sink;
  }

  /**
   * Performs a fractal expansion of a logical void.
   *
   * When a delta sink is wired (via setDeltaSink), mutations are posted as
   * Delta.Ingest records and applied during the next tick(). Otherwise falls
   * back to direct manifold writes for standalone / test usage.
   */
  public async expand(voidPreceptId: number, topic?: string): Promise<boolean> {
    const activeTopic =
      topic ||
      this.atomizer
        .decodeSequence(new Uint32Array([voidPreceptId]), this.system)
        .trim();

    const fullContent = await this.fetchContent(activeTopic);
    if (!fullContent) return false;

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

    // Fallback: direct manifold write (standalone / tests without ManifoldManager).
    const newPreceptIds = this.ingestContent(fullContent);
    if (newPreceptIds.length === 0) return false;

    const jitterRange = DOPAT_CONFIG.structural.DREAM_POS_X_JITTER;

    for (const id of Array.from(newPreceptIds)) {
      this.system.mass[id] = this.system.c * 10;

      // Concept-centroid posX with small jitter: keeps dreamt facts near their parent
      // concept for geodesic reachability while giving each fact a distinct position
      // so semantic diversity is not collapsed to a single coordinate.
      const jitter = (Math.random() - 0.5) * jitterRange;
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
    return "";
  }

  /**
   * Synchronously ingests pre-fetched text into the manifold.
   */
  public ingestContent(text: string, system?: System): Uint32Array {
    return this.atomizer.ingestSequence(text, system ?? this.systemRef.current);
  }

  /**
   * Resolves a scope hash back to its original token string.
   */
  public resolveScope(scope: number): string | undefined {
    return this.atomizer.resolveScope(scope);
  }

  /** Fetches encyclopedic context from Wikipedia with a hard timeout. */
  private async queryWikipedia(topic: string): Promise<string | null> {
    try {
      const extract = await withTimeout(
        wiki
          .page(topic)
          .then(p => p.summary())
          .then(s => s.extract),
        topic
      );
      return extract.replace(/\n/g, " ").trim() || null;
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
