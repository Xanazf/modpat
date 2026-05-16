import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { DOPAT_CONFIG } from "@config";

type MetricType = "counter" | "histogram" | "gauge";

export interface MetricEntry {
  type: MetricType;
  value: number;
  count: number;
  sum: number;
  min: number;
  max: number;
}

class Metrics {
  private static _instance: Metrics | null = null;
  private readonly data: Map<string, MetricEntry> = new Map();
  private tickCount = 0;

  static get(): Metrics {
    if (!this._instance) this._instance = new Metrics();
    return this._instance;
  }

  /** Increment a counter metric. */
  increment(name: string, by = 1): void {
    const e = this.ensure(name, "counter");
    e.value += by;
  }

  /** Set a gauge metric to an absolute value. */
  gauge(name: string, value: number): void {
    const e = this.ensure(name, "gauge");
    e.value = value;
  }

  /** Record a histogram sample (updates running average, min, max). */
  record(name: string, value: number): void {
    const e = this.ensure(name, "histogram");
    e.count++;
    e.sum += value;
    if (value < e.min) e.min = value;
    if (value > e.max) e.max = value;
    e.value = e.sum / e.count;
  }

  /** Return a plain-object snapshot of all metrics. */
  getSnapshot(): Record<string, MetricEntry> {
    return Object.fromEntries(this.data);
  }

  /** Call once per ManifoldLifecycle tick; emits JSONL every N ticks. */
  onTick(): void {
    this.tickCount++;
    if (
      this.tickCount %
        DOPAT_CONFIG.observability.METRICS_EMIT_INTERVAL_TICKS ===
      0
    ) {
      this.emit();
    }
  }

  /** Reset all metrics (useful for isolated tests). */
  reset(): void {
    this.data.clear();
    this.tickCount = 0;
  }

  private emit(): void {
    const path = DOPAT_CONFIG.observability.METRICS_LOG_PATH;
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(
        path,
        JSON.stringify({ ts: Date.now(), metrics: this.getSnapshot() }) + "\n"
      );
    } catch {
      // Fire-and-forget; log failure must not crash the engine
    }
  }

  private ensure(name: string, type: MetricType): MetricEntry {
    let e = this.data.get(name);
    if (!e) {
      e = { type, value: 0, count: 0, sum: 0, min: Infinity, max: -Infinity };
      this.data.set(name, e);
    }
    return e;
  }
}

export const metrics = Metrics.get();
