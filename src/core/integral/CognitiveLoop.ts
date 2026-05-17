/**
 * CognitiveLoop - the manifold-native autonomous motivation driver.
 *
 * Every COGNITIVE_TICK_MS (default 5 s) it:
 *   1. SENSES - scans its tracked Intent precept set.
 *   2. SELECTS - picks the one with the highest urgency (mass × temporal freshness posW).
 *   3. ACTS - dispatches the appropriate subsystem based on the intent tag.
 *   4. REINFORCES or DECAYS - updates the precept mass depending on success.
 *
 * Intent precepts are created by external motivation sources (InquiryQueue,
 * gap scanner, Resolver bridge-miss callback, unknown-topic detection) and
 * registered via registerIntent().  The loop decays and eventually discards
 * intents that consistently fail to resolve.
 */

import { DOPAT_CONFIG } from "@config";
import type Runtime from "@core_i/Runtime";
import { OperatorClass } from "@core_i/System";
import {
  boostIntent,
  decayIntent,
  IntentTag,
  spawnIntent,
} from "@utils/intentPrecept";
import logger from "@utils/SpectralLogger";

const COGNITIVE_TICK_MS =
  (DOPAT_CONFIG.observability as any).COGNITIVE_TICK_MS ?? 5_000;

export class CognitiveLoop {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _intentIds = new Set<number>();
  private _tagMap = new Map<number, IntentTag>();
  private _tickCount = 0;
  /**
   * Consecutive failure count per intent ID.  Selection score is divided by
   * (1 + failures²) so a persistently-failing intent backs off exponentially
   * and stops starving every other intent in the queue.  Reset to 0 on success.
   */
  private _failureCount = new Map<number, number>();

  constructor(private readonly runtime: Runtime) {}

  start(intervalMs: number = COGNITIVE_TICK_MS): void {
    if (this._timer !== null) return;
    this._timer = setInterval(
      () => this._tick().catch(e => logger.warn("[CLOOP]", e)),
      intervalMs
    );
    logger.debug("[CLOOP] started");
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Register a new Intent precept.  Called by motivation sources
   * (InquiryQueue.onEnqueue, gap scanner, Resolver bridge-miss callback).
   */
  registerIntent(id: number, tag: IntentTag): void {
    this._intentIds.add(id);
    this._tagMap.set(id, tag);
  }

  /**
   * Convenience: spawn + register an intent precept in one call.
   */
  spawnAndRegister(
    topic: string,
    urgency: number,
    tag: IntentTag
  ): number | null {
    const id = spawnIntent(
      this.runtime.system,
      this.runtime.atomizer,
      topic,
      urgency,
      tag,
      this._tagMap
    );
    if (id !== null) this._intentIds.add(id);
    return id;
  }

  private async _tick(): Promise<void> {
    const { system, inference, unfolder, resolver } = this.runtime;
    this._tickCount++;

    // 1. SENSE - prune freed/decayed IDs
    for (const id of this._intentIds) {
      if (!system.isAllocated(id) || system.mass[id] <= 0) {
        this._intentIds.delete(id);
        this._tagMap.delete(id);
        this._failureCount.delete(id);
      }
    }

    // Every ~60 s (12 ticks at 5 s), scan vault for underexplored proofs.
    if (this._tickCount % 12 === 0) {
      this._scanVaultUnderexplored().catch(() => {});
    }

    if (this._intentIds.size === 0) return;

    // 2. SELECT - highest urgency: mass × posW, penalised by consecutive
    // failures.  Score is divided by (1 + failures²) so an intent that fails
    // K times in a row needs 2× the urgency of a fresh intent after 1 failure,
    // 5× after 2, 10× after 3, etc.  This prevents a single broken intent
    // (e.g., Wikipedia is down) from occupying every tick indefinitely.
    let bestId = -1;
    let bestScore = -Infinity;
    for (const id of this._intentIds) {
      const failures = this._failureCount.get(id) ?? 0;
      const rawScore = system.mass[id] * system.posW[id];
      const score = rawScore / (1 + failures * failures);
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    if (bestId < 0) return;

    const tag = this._tagMap.get(bestId) ?? IntentTag.USER_UNKNOWN;
    const topic =
      this.runtime.atomizer.resolveScope(system.scope[bestId]) ?? "";

    // 3. ACT
    let success = false;
    try {
      switch (tag) {
        case IntentTag.INQUIRY_GAP:
          await inference
            .getInquiryQueue()
            .step(
              1,
              unfolder,
              resolver,
              system,
              this.runtime.atomizer,
              this.runtime.store
            );
          success = true;
          break;

        case IntentTag.CONSTELLATION_GAP: {
          if (topic) {
            const probeIds = this.runtime.atomizer.ingestSequence(
              topic,
              system
            );
            const result = await resolver.resolveCoherent(probeIds, {
              probeMode: true,
              maxIterations: 3,
            });
            success =
              result.diagnosis === "coherent" || result.diagnosis === "weak";
          }
          break;
        }

        case IntentTag.VAULT_PROMOTE: {
          const candidates = await this.runtime.store.sampleForChallenge(1);
          if (candidates.length > 0) {
            await inference.getLearner().challenge(candidates[0]);
            success = true;
          }
          break;
        }

        case IntentTag.USER_UNKNOWN: {
          if (topic) {
            const content = await unfolder.fetchContent(topic);
            if (content) {
              unfolder.ingestContent(content, system);
              success = true;
            }
          }
          break;
        }
      }
    } catch (e) {
      logger.warn(`[CLOOP] dispatch error for "${topic}":`, e);
    }

    // 4. REINFORCE or DECAY
    if (success) {
      decayIntent(system, bestId, 0.5); // acted on, reduce urgency
      this._failureCount.delete(bestId); // reset backoff on success
    } else {
      decayIntent(system, bestId, 0.9); // softer mass decay on failure
      this._failureCount.set(bestId, (this._failureCount.get(bestId) ?? 0) + 1);
    }
  }

  /** Scan vault for facts with high usage but low knowledge_state and spawn Intents. */
  private async _scanVaultUnderexplored(): Promise<void> {
    try {
      const candidates = await this.runtime.store.sampleForChallenge(3);
      for (const c of candidates) {
        if (c.knowledgeState < 2) {
          this.spawnAndRegister(
            c.factText.split(" ")[0] ?? c.factText,
            1.5,
            IntentTag.VAULT_PROMOTE
          );
        }
      }
    } catch {}
  }
}
