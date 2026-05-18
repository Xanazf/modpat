/**
 * VocabSeedWorker - background semantic substrate builder.
 *
 * Iterates the GloVe/UMAP vocabulary (data/dictionary.txt), queries WordNet
 * for each word, and for any word that yields ≥ 3 synonyms:
 *   1. Crystallizes all synonym pairs as wave-form proofs (energy 0.9).
 *   2. Inserts each fact into raw_facts so Phase 2 vault search finds them.
 *   3. Promotes every produced fact's knowledge_state to Learned (2).
 *
 * Three synonyms = three distinct "environments" in which the synonym
 * relationship can be reproduced, matching the epistemological threshold
 * used by the Learner.  This pre-seeds the constellations - synonym webs
 * that share the "is" IdentityShift operator become constructive-interference
 * clusters.  Once enough of a word's neighbourhood is seeded, the resolver
 * can traverse the topology transitively without any explicit instruction.
 */

import fs from "node:fs";
import type Store from "@core_s/Memory";
import type { DictionaryExpander, DictionaryExpansion } from "@core_s/Unfolder";
import type { WorkerPool } from "@core_s/WorkerPool";

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
    // S16 fix: admit hyphenated forms, contractions, and mixed-case proper nouns
    // that exist in the GloVe dictionary, not just plain lowercase words.
    this.words = raw
      .map(w => w.trim())
      .filter(w => /^[a-zA-Z][a-zA-Z\-']{2,}$/.test(w) && w !== "<unk>");
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
      pool?: WorkerPool;
    } = {}
  ): void {
    if (this._running || this.isDone) return;
    this._running = true;
    // Conservative defaults: 5 words per 1 s keeps DB pressure low enough
    // for the GC to reclaim prepared-statement and result objects between ticks.
    // At this rate the full 400k-word vocabulary takes ~22 hours - intentional,
    // the seeder is a background enrichment task, not a one-shot loader.
    const { batchSize = 5, intervalMs = 1000, onProgress, pool } = opts;

    const tick = () => {
      if (!this._running || this.isDone) {
        this._running = false;
        return;
      }
      this._processBatch(system, atomizer, store, dict, batchSize, pool)
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
    batchSize: number,
    pool?: WorkerPool
  ): Promise<void> {
    const end = Math.min(this.cursor + batchSize, this.words.length);

    for (let i = this.cursor; i < end; i++) {
      // Yield to the event loop between every word so the GC can reclaim
      // the prepared-statement and result objects from the previous word's
      // DB operations before the next batch of allocations begins.
      await new Promise<void>(r => setTimeout(r, 0));

      const word = this.words[i];

      // When a seed worker is available, offload the heavy WordNet Map
      // allocations to the worker heap; the main thread only does DB writes.
      let result: DictionaryExpansion;
      if (pool) {
        result = await pool.lookupWord(word);
        // Replicate the manifold ingestion that DictionaryExpander.expand() does.
        if (result.found) {
          const norm = word.replace(/_/g, " ");
          const seen = new Set<string>();
          // G7 fix (pool path): crystallize word→def and word→syn as distinct
          // input/output pairs instead of self-loops.
          const wordIds = atomizer.ingestSequence(norm, system);
          for (const def of result.definitions.slice(0, 3)) {
            const defText = def.split(" ").slice(0, 8).join(" ");
            const key = `${norm}>${defText}`;
            if (!seen.has(key)) {
              seen.add(key);
              const defIds = atomizer.ingestSequence(defText, system);
              await store.crystallizeProof(wordIds, defIds, 0.8);
            }
          }
          for (const syn of result.synonyms.slice(0, 6)) {
            const key = `${norm}>${syn}`;
            if (!seen.has(key)) {
              seen.add(key);
              const synIds = atomizer.ingestSequence(syn, system);
              await store.crystallizeProof(wordIds, synIds, 0.9);
            }
          }
        }
      } else {
        result = await dict.expand(word, system, atomizer, store);
      }

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
