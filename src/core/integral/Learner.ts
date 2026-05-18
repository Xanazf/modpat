import { createHash } from "node:crypto";
import { DOPAT_CONFIG } from "@config";
import type Resolver from "@core_i/Resolver";
import type { ResolverDiagnostics } from "@core_i/Resolver";
import { OperatorClass, type SystemRef } from "@core_i/System";
import type Store from "@core_s/Memory";
import type Unfolder from "@core_s/Unfolder";
import logger from "@utils/SpectralLogger";
import { extractTopic } from "@utils/topicExtraction";

// Deliberately unrelated topics used to create Env 3 for Generalized promotion.
// An unrelated expansion creates a maximally different context fingerprint, so
// reproduction in this environment proves the fact is truly context-independent.
const NOISE_PROBES = [
  "mathematics",
  "ocean",
  "atmosphere",
  "civilization",
  "architecture",
  "astronomy",
  "chemistry",
  "philosophy",
  "electricity",
  "geography",
  "evolution",
  "mythology",
];

function contextFingerprint(system: Root.ManifoldView): string {
  const n = system.length;
  const sample = Array.from(system.scope.subarray(0, Math.min(100, n)));
  return createHash("sha256")
    .update(`${n}:${sample.join(",")}`)
    .digest("hex")
    .slice(0, 16);
}

function buildProbeText(factText: string): string | null {
  const tokens = factText
    .trim()
    .split(/\s+/)
    .filter(t => t.length > 0);
  if (tokens.length < 2) return null;
  tokens.pop();
  return tokens.join(" ") + " |-";
}

function normalise(s: string): string {
  return s.toLowerCase().replace(/\|-/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Learner implements the epistemological learning loop:
 *
 *   "I have learned X"
 *   = "I have been able to reproduce the result of X in more than 1 environment
 *      on my own (without direct recall)"
 *
 * It samples low-confidence facts from the vault, challenges the resolver in
 * probe mode (no vault, no NLP), and promotes facts whose results can be
 * reproduced in 2+ distinct manifold contexts.
 */
export class Learner {
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
   * Does NOT update the vault - the caller decides what to do with the result.
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
        hasGeneralizationSignal: false,
        diagnostics: null,
        probeIds: new Uint32Array(0),
      };
    }

    const probeIds = this.atomizer.ingestSequence(probeText, this.system);

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
      `[LEARNER] challenge "${probeText}" → "${reproduced}" ` +
        `(expected: "${candidate.targetPattern}", ` +
        `coherence: ${coherentResult.coherence.toFixed(3)}, ` +
        `diagnosis: ${coherentResult.diagnosis}, success: ${success})`
    );

    // Generalization signal: if any bridge candidate whose label does NOT appear
    // in the fact text participated in the resolution, the system reached the
    // answer via a stepping stone from a different domain.
    const factWords = new Set(candidate.factText.toLowerCase().split(/\s+/));
    const hasGeneralizationSignal =
      success &&
      (coherentResult.diagnostics?.bridgeCandidates ?? []).some(
        b =>
          !b.isMissingLink &&
          b.bridgeScore > 0.05 &&
          !factWords.has(b.label.toLowerCase())
      );

    logger.debug(
      `[LEARNER] challenge "${probeText}" → "${reproduced}" ` +
        `(expected: "${candidate.targetPattern}", ` +
        `coherence: ${coherentResult.coherence.toFixed(3)}, ` +
        `diagnosis: ${coherentResult.diagnosis}, success: ${success}, ` +
        `genSignal: ${hasGeneralizationSignal})`
    );

    return {
      success,
      reproduced,
      expected: candidate.targetPattern,
      contextHash,
      coherence: coherentResult.coherence,
      learned: coherentResult.learned,
      hasGeneralizationSignal,
      diagnostics: coherentResult.diagnostics,
      probeIds,
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

      const result1 = await this.challenge(candidate);
      let bestResult = result1;
      if (result1.success && !existingHashes.has(result1.contextHash)) {
        repCount++;
        existingHashes.add(result1.contextHash);
      }
      for (const l of result1.learned) {
        if (!report.expandedTopics.includes(l)) report.expandedTopics.push(l);
      }
      // Generalization fast-track: if coherentResult shows a cross-domain bridge
      // in Env 1, the system proved it can generalize from first principles.
      // One successful cross-domain reproduction counts as two distinct contexts.
      const generalizationFastTrack =
        result1.hasGeneralizationSignal && result1.success;

      let expandedTopic = "";

      // Env 2: related topic expansion (existing behavior for Learned promotion).
      if (repCount < 2) {
        const topic = extractTopic(candidate.factText);
        if (topic) {
          const voidScope = this.atomizer.getSymbolScope("void", false);
          const voidId = this.system.createLocation(-this.system.c, voidScope);
          const expanded = await this.unfolder.expand(voidId, topic);
          if (expanded) {
            expandedTopic = topic;
            report.expandedTopics.push(topic);
            const result2 = await this.challenge(candidate);
            if (result2.success) bestResult = result2;
            if (result2.success && !existingHashes.has(result2.contextHash)) {
              repCount++;
              existingHashes.add(result2.contextHash);
            }
          }
        }
      }

      // Env 3: unrelated noise expansion for Generalized promotion.
      //
      // A fact is Generalized when it holds in a context that has NOTHING to do
      // with the fact itself - the system isn't leaning on related topology to
      // reproduce it, it has truly internalized the connection.
      // We pick a noise topic that avoids all words in the fact text, expand it
      // into the manifold (adding unrelated noise), and re-challenge.
      if (repCount >= 2 && candidate.knowledgeState < 3) {
        const factWords = candidate.factText.toLowerCase().split(/\s+/);
        const noiseTopic =
          NOISE_PROBES.find(t => !factWords.includes(t)) ?? NOISE_PROBES[0];
        const noiseScope = this.atomizer.getSymbolScope("void", false);
        const noiseVoidId = this.system.createLocation(
          -this.system.c,
          noiseScope
        );
        const noiseExpanded = await this.unfolder.expand(
          noiseVoidId,
          noiseTopic
        );
        if (noiseExpanded) {
          const result3 = await this.challenge(candidate);
          if (result3.success) bestResult = result3;
          if (result3.success && !existingHashes.has(result3.contextHash)) {
            repCount++;
            existingHashes.add(result3.contextHash);
            if (!report.expandedTopics.includes(noiseTopic))
              report.expandedTopics.push(noiseTopic);
          }
        }
      }

      const prevState = candidate.knowledgeState;
      let newState: Memory.KnowledgeState = prevState;
      if ((repCount >= 3 || generalizationFastTrack) && prevState < 3) {
        newState = 3; // Generalized: cross-domain or 3+ distinct contexts
      } else if (repCount >= 2 && prevState < 2) {
        newState = 2; // Learned: reproduced in 2 distinct contexts
      } else if (repCount >= 1 && prevState < 1) {
        newState = 1; // Remembered: recalled at least once
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
        if (newState >= 2) {
          // Crystallize at 1.5× for Learned, 2.0× for Generalized - the more
          // robust the reproduction, the higher the vault confidence.
          await this.crystallizeLearnedPath(
            candidate,
            bestResult.diagnostics,
            bestResult.probeIds,
            newState === 3 ? 2.0 : 1.5
          );
        }
        logger.debug(
          `[LEARNER] "${candidate.factText}" promoted ` +
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

  private async crystallizeLearnedPath(
    candidate: Memory.ChallengeCandidate,
    diagnostics: any,
    probeIds: Uint32Array,
    energy: number = 1.5
  ): Promise<void> {
    const diag = diagnostics;
    if (!diag || diag.sinkCandidates.length === 0) return;

    const probeText = buildProbeText(candidate.factText);
    if (!probeText) return;

    const inputIds = probeIds;
    const best = diag.sinkCandidates[0];
    const outputIds = new Uint32Array([best.id]);

    await this.store.crystallizeProof(inputIds, outputIds, energy);
    await this.store.updateKnowledgeState(
      candidate.signature,
      energy >= 2.0 ? 3 : 2,
      candidate.reproductionCount + 2,
      candidate.contextHash
    );

    logger.debug(
      `[LEARNER] Crystallized learned path for "${candidate.factText}" ` +
        `→ "${best.label}" at 1.5× energy`
    );
  }

  private resultMatchesExpected(reproduced: string, expected: string): boolean {
    const r = normalise(reproduced);
    const e = normalise(expected);
    if (r === e) return true;
    if (e.length > 0 && (r.includes(e) || e.includes(r))) return true;
    return false;
  }

  private stateName(s: Memory.KnowledgeState): string {
    return ["Heard", "Remembered", "Learned", "Generalized"][s] ?? String(s);
  }
}

export default Learner;

// InquiryQueue

export type InquiryStatus =
  | "pending"
  | "tried_dict"
  | "tried_wiki"
  | "ask_user"
  | "resolved";

export interface InquiryItem {
  id: string;
  topic: string;
  originalQuery: string;
  status: InquiryStatus;
  addedAt: number;
  attempts: number;
}

/**
 * InquiryQueue - the system's backlog of things it does not understand.
 *
 * Tracks topics that returned "unknown" so the system can reason about them
 * proactively: pending → tried_dict → tried_wiki → ask_user → resolved.
 */
export class InquiryQueue {
  private items: Map<string, InquiryItem> = new Map();
  private store?: Store;
  /** Optional hook called on each new enqueue - used by CognitiveLoop to spawn Intent precepts. */
  public onEnqueue?: (topic: string) => void;

  constructor(store?: Store) {
    this.store = store;
  }

  /** Bulk-load items from a previous session (called once at boot). */
  public populate(items: InquiryItem[]): void {
    for (const item of items) {
      if (!this.items.has(item.id)) this.items.set(item.id, item);
    }
  }

  private _persist(): void {
    this.store
      ?.saveInquiryQueue([...this.items.values()])
      .catch(e => logger.warn("[INQUIRY PERSIST]", e));
  }

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
    this._persist();
    this.onEnqueue?.(id);
  }

  /**
   * Immediately escalates a topic to `ask_user` status, bypassing the
   * dict/wiki resolution pipeline.  Use this for syntactically obvious
   * placeholders (`[]`, `?`, `_`) where lookup would never succeed.
   */
  public enqueueImmediate(topic: string, originalQuery: string): void {
    const id = topic.toLowerCase().trim();
    if (!id || this.items.has(id)) return;
    this.items.set(id, {
      id,
      topic: id,
      originalQuery,
      status: "ask_user",
      addedAt: Date.now(),
      attempts: 0,
    });
    logger.debug(`[INQUIRY] immediate escalation "${id}"`);
    this._persist();
    this.onEnqueue?.(id);
  }

  public resolve(topic: string): void {
    const item = this.items.get(topic.toLowerCase().trim());
    if (item) {
      item.status = "resolved";
      logger.debug(`[INQUIRY] resolved "${topic}"`);
      this._persist();
    }
  }

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

  public async step(
    limit: number,
    unfolder: Unfolder | null,
    resolver: Resolver,
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store?: Store,
    /** Called when an inquiry resolves automatically (dict/wiki) so the result
     *  can be re-surfaced to the user immediately rather than silently discarded. */
    onResolved?: (item: InquiryItem, answer: string) => void
  ): Promise<InquiryItem[]> {
    const toAsk: InquiryItem[] = [];

    const candidates = [...this.items.values()]
      .filter(i => i.status === "pending" || i.status === "tried_dict")
      .slice(0, limit);

    for (const item of candidates) {
      item.attempts++;

      if (item.status === "pending" && unfolder?.dictionary.isReady) {
        const result = await unfolder.dictionary.expand(
          item.topic,
          system,
          atomizer,
          store
        );
        item.status = "tried_dict";
        if (result.found) {
          const answer = await this._retry(
            item,
            resolver,
            atomizer,
            system,
            store
          );
          if (answer !== null) {
            item.status = "resolved";
            onResolved?.(item, answer);
            continue;
          }
        }
      } else if (item.status === "pending") {
        item.status = "tried_dict";
      }

      if (item.status === "tried_dict" && unfolder) {
        const voidScope = atomizer.getSymbolScope("void", false);
        const voidId = system.createLocation(-system.c, voidScope);
        const expanded = await unfolder.expand(voidId, item.topic, store);
        item.status = "tried_wiki";
        if (expanded) {
          const answer = await this._retry(
            item,
            resolver,
            atomizer,
            system,
            store
          );
          if (answer !== null) {
            item.status = "resolved";
            onResolved?.(item, answer);
            continue;
          }
        }
      }

      if (item.status === "tried_wiki" || item.status === "tried_dict") {
        item.status = "ask_user";
        toAsk.push(item);
        logger.debug(`[INQUIRY] escalating "${item.topic}" to user`);
      }
    }

    return toAsk;
  }

  /**
   * Re-runs the original query after an expansion and, crucially, crystallizes
   * the newly-discovered connection if resolution succeeds.  Returns the decoded
   * answer string on success or null on failure.
   *
   * Crystallization closes the loop: the inquiry identified a gap, the unfolder
   * filled it, and now the resulting inference path is persisted at slightly
   * higher confidence (1.1×) so future queries benefit without re-expanding.
   */
  private async _retry(
    item: InquiryItem,
    resolver: Resolver,
    atomizer: Atomic.Engine,
    system: Root.ManifoldView,
    store?: Store
  ): Promise<string | null> {
    const q = item.originalQuery.includes("|-")
      ? item.originalQuery
      : `${item.originalQuery} |-`;
    const ids = atomizer.ingestSequence(q, system);
    const result = await resolver.resolveCoherent(ids, { maxIterations: 2 });
    const decoded = atomizer.decodeSequence(result.ids, system).trim();
    if (result.diagnosis === "coherent" && decoded && decoded !== "unknown") {
      logger.debug(`[INQUIRY] retry resolved "${item.topic}" → "${decoded}"`);
      // Crystallize: the gap was filled and the inference now holds - persist it.
      if (store) {
        await store.crystallizeProof(ids, result.ids, 1.1);
      }
      return decoded;
    }
    return null;
  }
}
