/**
 * CognitiveLoop - DEPRECATED.  Phase 3 of the "Mapper as Thinker" refactor
 * folded autonomous motivation (timers, intent registration, gap scan
 * dispatch) into the Mapper.  This file remains as a back-compat shim so
 * existing imports / tests keep compiling.  New callers should drive the
 * Mapper directly via `Mapper.startAutonomy()` / `Mapper.spawnIntent()`.
 */

import type Runtime from "@core_i/Runtime";
import type { IntentTag } from "@utils/intentPrecept";

export class CognitiveLoop {
  constructor(private readonly runtime: Runtime) {}

  start(_intervalMs?: number): void {
    this.runtime.mapper.startAutonomy();
  }

  stop(): void {
    this.runtime.mapper.stopAutonomy();
  }

  registerIntent(id: number, tag: IntentTag): void {
    this.runtime.mapper.registerIntent(id, tag);
  }

  spawnAndRegister(
    topic: string,
    urgency: number,
    tag: IntentTag
  ): number | null {
    return this.runtime.mapper.spawnIntent(topic, urgency, tag);
  }
}

export default CognitiveLoop;
