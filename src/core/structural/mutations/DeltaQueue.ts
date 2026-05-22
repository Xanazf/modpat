import { metrics } from "@core_s/Metrics";

/**
 * Bounded, typed queue for manifold mutations.
 * All async paths (dreamCycle, GPU readbacks, Unfolder) post Delta records here.
 * tick() is the sole consumer - drain() is called once per tick and applies the batch.
 */
export class DeltaQueue {
  private queue: Delta.Any[] = [];
  private readonly maxLen: number;

  constructor(maxLen = 10_000) {
    this.maxLen = maxLen;
  }

  post(delta: Delta.Any): void {
    if (this.queue.length >= this.maxLen) {
      metrics.increment("delta_queue.overflow");
      this.queue.shift();
    }
    this.queue.push(delta);
  }

  drain(): Delta.Any[] {
    const batch = this.queue;
    this.queue = [];
    return batch;
  }

  get length(): number {
    return this.queue.length;
  }
}
