/**
 * ManifoldReader - zero-copy read-only view over a System SharedArrayBuffer.
 *
 * Workers receive the buffer + layout via workerData and reconstruct typed-array
 * views here without importing the System class (which pulls in DuckDB, WordNet,
 * and the rest of the main-thread dependency tree).
 *
 * Only the subset of Root.ManifoldView needed by ManifoldMetrics / GridIndex4D
 * is implemented.  Write-path methods (update, createLocation, etc.) are no-ops
 * or throw - workers are read-only consumers.
 */

import type { ManifoldLayout } from "@core_i/System";

export class ManifoldReader {
  readonly mass: Float64Array;
  readonly scope: Float64Array;
  readonly depth: Float64Array;
  readonly time: Float64Array;
  readonly posX: Float64Array;
  readonly posY: Float64Array;
  readonly posZ: Float64Array;
  readonly posW: Float64Array;
  readonly density: Float64Array;
  readonly entropyRate: Float64Array;
  readonly potency: Float64Array;
  readonly intensity: Float64Array;
  readonly decayRate: Float64Array;
  readonly checksum: Float64Array;
  readonly PartLayer: Uint32Array;
  readonly ComplexLayer: Uint32Array;
  readonly operatorClass: Uint8Array;
  readonly allocated: Uint8Array;
  readonly slotType: Uint8Array;

  readonly c: number;
  readonly epsilon: number;
  readonly maxilon: number;

  /** Snapshot of manifold.length at the time the task was posted. */
  length: number;

  /** Stub: workers never write signals. */
  readonly patbuf: string[] = [];

  constructor(
    buffer: SharedArrayBuffer,
    layout: ManifoldLayout,
    length: number
  ) {
    const { offsets: o, maxPrecepts: n } = layout;
    this.mass = new Float64Array(buffer, o.mass, n);
    this.scope = new Float64Array(buffer, o.scope, n);
    this.depth = new Float64Array(buffer, o.depth, n);
    this.time = new Float64Array(buffer, o.time, n);
    this.posX = new Float64Array(buffer, o.posX, n);
    this.posY = new Float64Array(buffer, o.posY, n);
    this.posZ = new Float64Array(buffer, o.posZ, n);
    this.posW = new Float64Array(buffer, o.posW, n);
    this.density = new Float64Array(buffer, o.density, n);
    this.entropyRate = new Float64Array(buffer, o.entropyRate, n);
    this.potency = new Float64Array(buffer, o.potency, n);
    this.intensity = new Float64Array(buffer, o.intensity, n);
    this.decayRate = new Float64Array(buffer, o.decayRate, n);
    this.checksum = new Float64Array(buffer, o.checksum, n);
    this.PartLayer = new Uint32Array(buffer, o.PartLayer, n);
    this.ComplexLayer = new Uint32Array(buffer, o.ComplexLayer, n);
    this.operatorClass = new Uint8Array(buffer, o.operatorClass, n);
    this.allocated = new Uint8Array(buffer, o.allocated, n);
    this.slotType = new Uint8Array(buffer, o.slotType, n);

    this.c = layout.c;
    this.epsilon = layout.epsilon;
    this.maxilon = layout.maxilon;
    this.length = length;
  }

  isAllocated(id: number): boolean {
    return id > 0 && id < this.length && this.allocated[id] === 1;
  }

  getScope(id: number): number {
    return this.scope[id];
  }

  getIdsByScope(scope: number): ReadonlySet<number> {
    const s = new Set<number>();
    for (let i = 1; i < this.length; i++) {
      if (this.allocated[i] === 1 && this.scope[i] === scope) s.add(i);
    }
    return s;
  }

  // Stubs for write-path methods not needed in workers
  update(_id: number): void {}
  setScope(_id: number, _scope: number): void {}
  createLocation(_m: number, _s: number): number {
    return 0;
  }
  freeLocation(_id: number): void {}
  setSequenceStart(_s: number, _id: number): void {}
  getSequenceStart(_id: number): number {
    return -1;
  }
  getSequenceEntries(): { scope0: number; startId: number }[] {
    return [];
  }
  refreshConceptAge(_scope: number): void {}
  decay(_dt: number): void {}
}
