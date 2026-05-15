import { createHash } from "node:crypto";
import { DOPAT_CONFIG } from "@config";
import { OperatorClass, SystemRef } from "@core_i/System";
import type Resolver from "@core_i/Resolver";
import type Store from "@core_s/Memory";
import type Unfolder from "@core_s/Unfolder";
import logger from "@utils/SpectralLogger";

/**
 * Builds a stable fingerprint of the current manifold state.
 * Two fingerprints differ when the manifold has been extended with new precepts,
 * which constitutes a distinct "environment" for the reproduction test.
 */
function contextFingerprint(system: Root.ManifoldView): string {
  const n = system.length;
  const sample = Array.from(system.scope.subarray(0, Math.min(100, n)));
  return createHash("sha256")
    .update(`${n}:${sample.join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Constructs the probe query from a raw fact string.
 *
 * Strategy: tokenize the fact text, drop the last token (the "answer"),
 * append the Sink operator "|-", then ingest. The resolver must derive
 * the dropped token purely from manifold resonance.
 *
 * "fire is hot" → "fire is |-"
 */
function buildProbeText(factText: string): string | null {
  const tokens = factText
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
  if (tokens.length < 2) return null;
  tokens.pop(); // remove last token (the expected answer)
  return tokens.join(" ") + " |-";
}

/**
 * Normalises a decoded token sequence for comparison: lowercase, collapse whitespace,
 * strip leading/trailing operators and punctuation so minor encoding differences
 * don't cause false negatives.
 */
function normalise(s: string): string {
  return s.toLowerCase().replace(/\|-/g, "").replace(/\s+/g, " ").trim();
}

/**
 * SelfTeacher implements the epistemological learning loop:
 *
 *   "I have learned X"
 *   = "I have been able to reproduce the result of X in more than 1 environment
 *      on my own (without direct recall)"
 *
 * It samples low-confidence facts from the vault, challenges the resolver in
 * probe mode (no vault, no NLP), and promotes facts whose results can be
 * reproduced in 2+ distinct manifold contexts.
 *
 * Environment 1 — probe in the current manifold.
 * Environment 2 — probe after the Unfolder has expanded adjacent concepts
 *                 (a richer manifold = a genuinely different context fingerprint).
 */
export class SelfTeacher {
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  private atomizer: Atomic.Engine;
  private resolver: Resolver;
  private store: Store;
  private unfolder: Unfolder;

  constructor(
    systemRef: SystemRef,
    atomizer: Atomic.Engine,
    resolver: Resolver,
    store: Store,
    unfolder: Unfolder
  ) {
    this.systemRef = systemRef;
    this.atomizer = atomizer;
    this.resolver = resolver;
    this.store = store;
    this.unfolder = unfolder;
  }

  /**
   * Attempts to reproduce the answer for a single candidate using probe mode.
   * Does NOT update the vault — the caller decides what to do with the result.
   */
  public async challenge(
    candidate: Memory.ChallengeCandidate
  ): Promise<Memory.ChallengeResult> {
    const contextHash = contextFingerprint(this.system);
    const probeText = buildProbeText(candidate.factText);

    if (!probeText) {
      return {
        success: false,
        reproduced: "",
        expected: candidate.targetPattern,
        contextHash,
        coherence: 0,
        learned: [],
      };
    }

    const probeIds = this.atomizer.ingestSequence(probeText, this.system);

    // Use the coherence loop in probe mode: up to 3 passes measuring amplitude ×
    // contrast so we know not just WHETHER an answer emerged but HOW confidently
    // the wave collapsed — and what the loop learned while trying.
    const coherentResult = await this.resolver.resolveCoherent(probeIds, {
      probeMode: true,
      maxIterations: 3,
    });

    const reproduced = this.atomizer
      .decodeSequence(coherentResult.ids, this.system)
      .trim();

    const success =
      normalise(reproduced).length > 0 &&
      normalise(reproduced) !== normalise(probeText) &&
      normalise(reproduced) !== "unknown" &&
      this.resultMatchesExpected(reproduced, candidate.targetPattern);

    logger.debug(
      `[SELF-TEACHER] challenge "${probeText}" → "${reproduced}" ` +
        `(expected: "${candidate.targetPattern}", ` +
        `coherence: ${coherentResult.coherence.toFixed(3)}, ` +
        `diagnosis: ${coherentResult.diagnosis}, success: ${success})`
    );

    return {
      success,
      reproduced,
      expected: candidate.targetPattern,
      contextHash,
      coherence: coherentResult.coherence,
      learned: coherentResult.learned,
    };
  }

  /**
   * Runs up to `batchSize` challenge rounds, updating the vault with any
   * promotions, and returns a summary report.
   */
  public async runCycle(
    batchSize: number = 10
  ): Promise<Memory.ValidationReport> {
    const candidates = await this.store.sampleForChallenge(batchSize);
    const report: Memory.ValidationReport = {
      challenged: candidates.length,
      promoted: 0,
      failed: 0,
      expandedTopics: [],
      summary: { heard: 0, remembered: 0, learned: 0, generalized: 0 },
    };

    for (const candidate of candidates) {
      const existingHashes = new Set(
        candidate.contextHash.split("|").filter(Boolean)
      );
      let repCount = candidate.reproductionCount;

      // Environment 1: probe in the current manifold.
      const result1 = await this.challenge(candidate);
      if (result1.success && !existingHashes.has(result1.contextHash)) {
        repCount++;
        existingHashes.add(result1.contextHash);
      }
      // Propagate what the coherence loop learned during Env 1.
      for (const l of result1.learned) {
        if (!report.expandedTopics.includes(l)) report.expandedTopics.push(l);
      }

      // Environment 2: if we still need another reproduction, try after expansion.
      let expandedTopic = "";
      if (repCount < 2) {
        const topic = this.extractTopic(candidate.factText);
        if (topic) {
          const voidScope = this.atomizer.getSymbolScope("void", false);
          const voidId = this.system.createLocation(-this.system.c, voidScope);
          const expanded = await this.unfolder.expand(voidId, topic);
          if (expanded) {
            expandedTopic = topic;
            report.expandedTopics.push(topic);
            const result2 = await this.challenge(candidate);
            if (result2.success && !existingHashes.has(result2.contextHash)) {
              repCount++;
              existingHashes.add(result2.contextHash);
            }
          }
        }
      }

      // Determine new knowledge state.
      const prevState = candidate.knowledgeState;
      let newState: Memory.KnowledgeState = prevState;
      if (repCount >= 2 && prevState < 2) {
        newState = 2; // Learned
      } else if (repCount >= 1 && prevState < 1) {
        newState = 1; // Remembered
      }

      const newCtxHash = [...existingHashes].slice(0, 5).join("|");
      await this.store.updateKnowledgeState(
        candidate.signature,
        newState,
        repCount,
        newCtxHash
      );

      if (newState > prevState) {
        report.promoted++;
        if (newState === 2) {
          await this.crystallizeLearnedPath(candidate);
        }
        logger.debug(
          `[SELF-TEACHER] "${candidate.factText}" promoted ` +
            `${this.stateName(prevState)} → ${this.stateName(newState)} ` +
            `(repCount=${repCount}${expandedTopic ? `, expanded="${expandedTopic}"` : ""})`
        );
      } else if (!result1.success && !expandedTopic) {
        report.failed++;
      }
    }

    report.summary = await this.store.getKnowledgeSummary();
    return report;
  }

  /**
   * When a fact reaches Learned state, crystallize the inferential path discovered
   * during the last probe at 1.5× the base energy, marking it as a Learned proof.
   * This creates a high-confidence shortcut in the vault for future inference.
   */
  private async crystallizeLearnedPath(
    candidate: Memory.ChallengeCandidate
  ): Promise<void> {
    const diag = this.resolver.lastDiagnostics;
    if (!diag || diag.sinkCandidates.length === 0) return;

    const probeText = buildProbeText(candidate.factText);
    if (!probeText) return;

    const inputIds = this.atomizer.ingestSequence(probeText, this.system);

    const best = diag.sinkCandidates[0];
    const outputIds = new Uint32Array([best.id]);

    await this.store.crystallizeProof(inputIds, outputIds, 1.5);
    await this.store.updateKnowledgeState(
      candidate.signature,
      2, // Learned
      candidate.reproductionCount + 2,
      candidate.contextHash
    );

    logger.debug(
      `[SELF-TEACHER] Crystallized learned path for "${candidate.factText}" ` +
        `→ "${best.label}" at 1.5× energy`
    );
  }

  /**
   * Checks whether the reproduced answer matches the expected target pattern.
   * Uses normalised substring matching to tolerate minor formatting differences.
   */
  private resultMatchesExpected(reproduced: string, expected: string): boolean {
    const r = normalise(reproduced);
    const e = normalise(expected);
    if (r === e) return true;
    // Accept if the reproduced answer contains the expected (or vice versa),
    // for cases where the target_pattern is a multi-token phrase.
    if (e.length > 0 && (r.includes(e) || e.includes(r))) return true;
    return false;
  }

  /**
   * Extracts the most semantically meaningful content word from a fact string
   * to use as the Unfolder expansion topic.
   *
   * Uses a static stopword list rather than ingesting tokens — ingestSequence
   * has manifold side effects and must not be called here.
   */
  private extractTopic(factText: string): string {
    const stop = new Set([
      "is",
      "are",
      "was",
      "were",
      "can",
      "and",
      "but",
      "or",
      "not",
      "all",
      "for",
      "the",
      "a",
      "an",
      "in",
      "of",
      "to",
      "it",
      "its",
      "has",
      "had",
      "have",
      "be",
      "been",
      "being",
      "do",
      "did",
      "does",
      "will",
      "would",
      "could",
      "should",
      "may",
      "might",
      "shall",
      "that",
      "this",
      "then",
      "than",
      "with",
      "from",
    ]);
    const tokens = factText
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 2 && !stop.has(t.toLowerCase()));
    // Longest content word is usually the most topically specific noun.
    return tokens.sort((a, b) => b.length - a.length)[0] ?? "";
  }

  private stateName(s: Memory.KnowledgeState): string {
    return ["Heard", "Remembered", "Learned", "Generalized"][s] ?? String(s);
  }
}

export default SelfTeacher;

// ── InquiryQueue ──────────────────────────────────────────────────────────────
// Co-located with SelfTeacher because both implement autonomous learning:
// SelfTeacher tests what the system *knows*; InquiryQueue investigates what
// the system *doesn't know* and escalates to the user when automated sources
// are exhausted.

export type InquiryStatus =
  | "pending" // not yet attempted
  | "tried_dict" // dictionary consulted, still unresolved
  | "tried_wiki" // wiki/unfolder consulted too, still unresolved
  | "ask_user" // all automated sources exhausted; awaiting user input
  | "resolved"; // answer found (from any source)

export interface InquiryItem {
  id: string; // = topic (dedup key)
  topic: string;
  originalQuery: string;
  status: InquiryStatus;
  addedAt: number;
  attempts: number;
}

/**
 * InquiryQueue — the system's backlog of things it does not understand.
 *
 * Tracks topics that returned "unknown" so the system can reason about them
 * proactively:
 *
 *   pending → (dictionary) → tried_dict
 *          → (unfolder)    → tried_wiki
 *          → (ask user)    → ask_user
 *          → (user answers or later resolution) → resolved
 *
 * The REPL drives processing by calling step() after each user turn.
 */
export class InquiryQueue {
  private items: Map<string, InquiryItem> = new Map();

  public enqueue(topic: string, originalQuery: string): void {
    const id = topic.toLowerCase().trim();
    if (!id || this.items.has(id)) return;
    this.items.set(id, {
      id,
      topic: id,
      originalQuery,
      status: "pending",
      addedAt: Date.now(),
      attempts: 0,
    });
    logger.debug(`[INQUIRY] enqueued "${id}"`);
  }

  public resolve(topic: string): void {
    const item = this.items.get(topic.toLowerCase().trim());
    if (item) {
      item.status = "resolved";
      logger.debug(`[INQUIRY] resolved "${topic}"`);
    }
  }

  /** Auto-resolves items whose topic appears in a user-provided text. */
  public checkForAnswers(text: string): void {
    const lower = text.toLowerCase();
    for (const item of this.items.values()) {
      if (item.status === "ask_user" && lower.includes(item.topic)) {
        item.status = "resolved";
        logger.debug(`[INQUIRY] auto-resolved "${item.topic}" from user input`);
      }
    }
  }

  public pendingUserQuestions(): InquiryItem[] {
    return [...this.items.values()].filter(i => i.status === "ask_user");
  }

  public get size(): number {
    return [...this.items.values()].filter(i => i.status !== "resolved").length;
  }

  /**
   * Process up to `limit` pending items.
   * The Unfolder's internal DictionaryExpander is tried first (fast, offline);
   * the Unfolder's network sources (Wikipedia / Context7) are the fallback.
   * Returns items that exhausted all automated sources and need user input.
   */
  public async step(
    limit: number,
    unfolder: Unfolder | null,
    resolver: Resolver,
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store?: Store
  ): Promise<InquiryItem[]> {
    const toAsk: InquiryItem[] = [];

    const candidates = [...this.items.values()]
      .filter(i => i.status === "pending" || i.status === "tried_dict")
      .slice(0, limit);

    for (const item of candidates) {
      item.attempts++;

      // 1. Dictionary via Unfolder (fast, offline)
      if (item.status === "pending" && unfolder?.dictionary.isReady) {
        const result = await unfolder.dictionary.expand(
          item.topic,
          system,
          atomizer,
          store
        );
        item.status = "tried_dict";
        if (result.found) {
          if (await this._retry(item, resolver, atomizer, system)) {
            item.status = "resolved";
            continue;
          }
        }
      } else if (item.status === "pending") {
        item.status = "tried_dict";
      }

      // 2. Unfolder network sources (Wikipedia / Context7)
      if (item.status === "tried_dict" && unfolder) {
        const voidScope = atomizer.getSymbolScope("void", false);
        const voidId = system.createLocation(-system.c, voidScope);
        const expanded = await unfolder.expand(voidId, item.topic, store);
        item.status = "tried_wiki";
        if (expanded) {
          if (await this._retry(item, resolver, atomizer, system)) {
            item.status = "resolved";
            continue;
          }
        }
      }

      // 3. Escalate to user
      if (item.status === "tried_wiki" || item.status === "tried_dict") {
        item.status = "ask_user";
        toAsk.push(item);
        logger.debug(`[INQUIRY] escalating "${item.topic}" to user`);
      }
    }

    return toAsk;
  }

  private async _retry(
    item: InquiryItem,
    resolver: Resolver,
    atomizer: Atomic.Engine,
    system: Root.ManifoldView
  ): Promise<boolean> {
    const q = item.originalQuery.includes("|-")
      ? item.originalQuery
      : `${item.originalQuery} |-`;
    const ids = atomizer.ingestSequence(q, system);
    const result = await resolver.resolveCoherent(ids, { maxIterations: 2 });
    const decoded = atomizer.decodeSequence(result.ids, system).trim();
    if (result.diagnosis === "coherent" && decoded && decoded !== "unknown") {
      logger.debug(`[INQUIRY] retry resolved "${item.topic}" → "${decoded}"`);
      return true;
    }
    return false;
  }
}
