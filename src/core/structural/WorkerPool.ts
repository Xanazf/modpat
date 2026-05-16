/**
 * WorkerPool — manages the three long-lived worker threads.
 *
 * Each worker handles a distinct concern:
 *   manifold.worker  — constellation / gap / orbital computation (SharedArrayBuffer, read-only)
 *   wiki.worker      — Wikipedia HTTP fetch (network-only, no shared memory)
 *   seed.worker      — WordNet dictionary lookup (no DB, main thread crystallizes)
 *
 * All calls return Promises resolved by a request-ID map so multiple in-flight
 * tasks are correctly correlated without serializing callers.
 */

import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { ManifoldLayout } from "@core_i/System";
import type { Constellation } from "@core_s/ManifoldMetrics";
import type { DictionaryExpansion } from "@core_s/Unfolder";
import type { RawGap } from "@core_s/workers/manifold.worker";

type Resolver<T> = { resolve: (v: T) => void; reject: (e: Error) => void };

function workerPath(name: string): string {
  return fileURLToPath(new URL(`./workers/${name}`, import.meta.url));
}

// Use tsx loader so TypeScript worker files execute without pre-compilation.
const TSX_EXECARGV = ["--import", "tsx"];

export interface OrbitalEntry {
  id: number;
  parentId: number | null;
  radius: number;
  satelliteCount: number;
}

export class WorkerPool {
  private manifoldWorker: Worker;
  private wikiWorker: Worker;
  private seedWorker: Worker;

  private manifoldPending = new Map<number, Resolver<any>>();
  private wikiPending = new Map<number, Resolver<string | null>>();
  private seedPending = new Map<number, Resolver<DictionaryExpansion>>();
  private seedReady = false;
  private seedQueue: Array<() => void> = [];

  private nextId = 1;
  private _buffer: SharedArrayBuffer;
  private _layout: ManifoldLayout;

  constructor(buffer: SharedArrayBuffer, layout: ManifoldLayout) {
    this._buffer = buffer;
    this._layout = layout;

    this.manifoldWorker = new Worker(workerPath("manifold.worker.ts"), {
      execArgv: TSX_EXECARGV,
      workerData: { buffer, layout },
    });
    this.manifoldWorker.on(
      "message",
      (msg: { id: number; result?: any; error?: string }) => {
        const pending = this.manifoldPending.get(msg.id);
        if (!pending) return;
        this.manifoldPending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.result);
      }
    );
    this.manifoldWorker.on("error", err =>
      this._rejectAll(this.manifoldPending, err)
    );

    this.wikiWorker = new Worker(workerPath("wiki.worker.ts"), {
      execArgv: TSX_EXECARGV,
    });
    this.wikiWorker.on(
      "message",
      (msg: { id: number; result?: string | null; error?: string }) => {
        const pending = this.wikiPending.get(msg.id);
        if (!pending) return;
        this.wikiPending.delete(msg.id);
        if (msg.error) pending.reject(new Error(msg.error));
        else pending.resolve(msg.result ?? null);
      }
    );
    this.wikiWorker.on("error", err => this._rejectAll(this.wikiPending, err));

    this.seedWorker = new Worker(workerPath("seed.worker.ts"), {
      execArgv: TSX_EXECARGV,
    });
    this.seedWorker.on("message", (msg: any) => {
      if (msg.ready) {
        this.seedReady = true;
        for (const fn of this.seedQueue) fn();
        this.seedQueue = [];
        return;
      }
      const pending = this.seedPending.get(msg.id);
      if (!pending) return;
      this.seedPending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error));
      else pending.resolve(msg.result);
    });
    this.seedWorker.on("error", err => this._rejectAll(this.seedPending, err));
  }

  private _rejectAll<T>(map: Map<number, Resolver<T>>, err: unknown): void {
    const e = err instanceof Error ? err : new Error(String(err));
    for (const { reject } of map.values()) reject(e);
    map.clear();
  }

  private _id(): number {
    return this.nextId++;
  }

  // Manifold tasks (read-only, SharedArrayBuffer)

  computeConstellations(length: number): Promise<Constellation[]> {
    const id = this._id();
    return new Promise((resolve, reject) => {
      this.manifoldPending.set(id, { resolve, reject });
      this.manifoldWorker.postMessage({ id, type: "constellations", length });
    });
  }

  computeGaps(consts: Constellation[], length: number): Promise<RawGap[]> {
    const id = this._id();
    return new Promise((resolve, reject) => {
      this.manifoldPending.set(id, { resolve, reject });
      this.manifoldWorker.postMessage({ id, type: "gaps", length, consts });
    });
  }

  computeOrbital(length: number): Promise<OrbitalEntry[]> {
    const id = this._id();
    return new Promise((resolve, reject) => {
      this.manifoldPending.set(id, { resolve, reject });
      this.manifoldWorker.postMessage({ id, type: "orbital", length });
    });
  }

  // Wiki task (network-only)

  fetchWikipedia(topic: string): Promise<string | null> {
    const id = this._id();
    return new Promise((resolve, reject) => {
      this.wikiPending.set(id, { resolve, reject });
      this.wikiWorker.postMessage({ id, topic });
    });
  }

  // Seed task (WordNet lookup only; main thread handles DuckDB writes)

  lookupWord(word: string): Promise<DictionaryExpansion> {
    const id = this._id();
    return new Promise((resolve, reject) => {
      this.seedPending.set(id, { resolve, reject });
      if (this.seedReady) {
        this.seedWorker.postMessage({ id, word });
      } else {
        this.seedQueue.push(() => this.seedWorker.postMessage({ id, word }));
      }
    });
  }

  async dispose(): Promise<void> {
    await Promise.all([
      this.manifoldWorker.terminate(),
      this.wikiWorker.terminate(),
      this.seedWorker.terminate(),
    ]);
  }
}
