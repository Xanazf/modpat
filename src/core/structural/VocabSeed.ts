/**
 * VocabSeedWorker — background semantic substrate builder.
 *
 * Iterates the GloVe/UMAP vocabulary (data/dictionary.txt), queries WordNet
 * for each word, and for any word that yields ≥ 3 synonyms:
 *   1. Crystallizes all synonym pairs as wave-form proofs (energy 0.9).
 *   2. Inserts each fact into raw_facts so Phase 2 vault search finds them.
 *   3. Promotes every produced fact's knowledge_state to Learned (2).
 *
 * Three synonyms = three distinct "environments" in which the synonym
 * relationship can be reproduced, matching the epistemological threshold
 * used by the Learner.  This pre-seeds the constellations — synonym webs
 * that share the "is" IdentityShift operator become constructive-interference
 * clusters.  Once enough of a word's neighbourhood is seeded, the resolver
 * can traverse the topology transitively without any explicit instruction.
 */

import fs from "node:fs";
import type { DictionaryExpander } from "@core_s/Unfolder";
import type Store from "@core_s/Memory";

export interface SeedProgress {
  processed: number;
  total: number;
  matured: number;
  running: boolean;
  done: boolean;
}

export class VocabSeedWorker {
  private readonly words: string[];
  private cursor = 0;
  private _running = false;
  private _matured = 0;
  private _processed = 0;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  get running(): boolean {
    return this._running;
  }
  get matured(): number {
    return this._matured;
  }
  get processed(): number {
    return this._processed;
  }
  get total(): number {
    return this.words.length;
  }
  get isDone(): boolean {
    return this.cursor >= this.words.length;
  }

  snapshot(): SeedProgress {
    return {
      processed: this._processed,
      total: this.words.length,
      matured: this._matured,
      running: this._running,
      done: this.isDone,
    };
  }

  constructor(dictPath: string) {
    if (!fs.existsSync(dictPath)) {
      this.words = [];
      return;
    }
    const raw = fs.readFileSync(dictPath, "utf8").split("\n");
    // Keep only plain lowercase English words (3+ chars, letters only).
    // Filters out punctuation tokens, numbers, proper nouns starting with
    // uppercase, and the trailing <unk> sentinel.
    this.words = raw.map(w => w.trim()).filter(w => /^[a-z]{3,}$/.test(w));
  }

  /**
   * Start the seeder. Non-blocking: processes one batch per timer tick so
   * the REPL event loop stays responsive.
   */
  start(
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store: Store,
    dict: DictionaryExpander,
    opts: {
      batchSize?: number;
      intervalMs?: number;
      onProgress?: (p: SeedProgress) => void;
    } = {}
  ): void {
    if (this._running || this.isDone) return;
    this._running = true;
    const { batchSize = 20, intervalMs = 150, onProgress } = opts;

    const tick = () => {
      if (!this._running || this.isDone) {
        this._running = false;
        return;
      }
      this._processBatch(system, atomizer, store, dict, batchSize)
        .then(() => {
          onProgress?.(this.snapshot());
          this._timer = setTimeout(tick, intervalMs);
        })
        .catch(err => {
          console.error("[VocabSeed] batch error:", err);
          this._timer = setTimeout(tick, 2000);
        });
    };

    this._timer = setTimeout(tick, 0);
  }

  pause(): void {
    this._running = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private async _processBatch(
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store: Store,
    dict: DictionaryExpander,
    batchSize: number
  ): Promise<void> {
    const end = Math.min(this.cursor + batchSize, this.words.length);

    for (let i = this.cursor; i < end; i++) {
      const word = this.words[i];
      const result = await dict.expand(word, system, atomizer, store);
      this._processed++;

      if (!result.found || result.synonyms.length < 3) continue;

      // Reconstruct the same fact strings that DictionaryExpander.expand()
      // produced so we get consistent signatures without re-ingesting.
      const wordStr = word.replace(/_/g, " ");
      const seen = new Set<string>();

      // Synonym pairs (DictionaryExpander already crystallized these; we now
      // add them to raw_facts and raise their knowledge state).
      for (const syn of result.synonyms.slice(0, 6)) {
        for (const [a, b] of [
          [wordStr, syn],
          [syn, wordStr],
        ] as const) {
          const fact = `${a} is ${b}`;
          if (seen.has(fact)) continue;
          seen.add(fact);
          const sig = store.signatureForText(fact);
          await store.storeFact(fact, "dict", 0.9, sig);
          await store.updateKnowledgeState(sig, 2, 3, "dict:wordnet");
        }
      }

      // Definition snippets (also already crystallized by DictionaryExpander).
      for (const def of result.definitions.slice(0, 3)) {
        const fact = `${wordStr} is ${def.split(" ").slice(0, 8).join(" ")}`;
        if (seen.has(fact)) continue;
        seen.add(fact);
        const sig = store.signatureForText(fact);
        await store.storeFact(fact, "dict", 0.85, sig);
        await store.updateKnowledgeState(sig, 2, 3, "dict:wordnet");
      }

      this._matured++;
    }

    this.cursor = end;
  }
}
