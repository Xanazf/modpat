/**
 * 4D grid-bucket spatial index using flat sorted arrays.
 * Quantizes 4D space into a uniform grid based on cellSize.
 *
 * For high performance and zero garbage collection overhead:
 * - Atom coordinates are quantized and hashed to a 32-bit integer.
 * - Atom IDs and hashes are packed into a double-precision Float64Array and sorted natively.
 * - Contiguous ranges of atoms matching each hash are indexed in a cellOffsets map.
 */

export class GridIndex4D {
  private ids: Uint32Array = new Uint32Array(0);
  private hashes: Uint32Array = new Uint32Array(0);
  private readonly cellOffsets: Map<number, [number, number]> = new Map();
  private readonly cellSize: number;
  private readonly TABLE_SIZE = 268435456; // 2^28 table size
  private readonly MULTIPLIER = 16777216; // 2^24 multiplier for packing

  // 1D sorted index by posW using IEEE-754 bit representation
  private sortedW: Float32Array = new Float32Array(0);
  private sortedIdsByW: Uint32Array = new Uint32Array(0);

  // Cache for buildFromSystem to prevent redundant rebuilds
  private lastBuiltSystem: Root.ManifoldView | null = null;
  private lastBuiltLength = -1;
  private lastBuiltSystemAge = -1;
  private lastBuiltVersion = -1;

  /** Cell edge length - lets callers quantize a point to its grid cell. */
  public get cellSizeValue(): number {
    return this.cellSize;
  }

  public getSortedW(): Float32Array {
    return this.sortedW;
  }

  public getSortedIdsByW(): Uint32Array {
    return this.sortedIdsByW;
  }

  // Temporary buffers to receive individual insert calls before final build
  private tempIds: number[] = [];
  private tempX: number[] = [];
  private tempY: number[] = [];
  private tempZ: number[] = [];
  private tempW: number[] = [];
  private isBuilt = false;

  constructor(cellSize = 40) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.tempIds = [];
    this.tempX = [];
    this.tempY = [];
    this.tempZ = [];
    this.tempW = [];
    this.cellOffsets.clear();
    this.isBuilt = false;
    this.sortedW = new Float32Array(0);
    this.sortedIdsByW = new Uint32Array(0);
    this.lastBuiltSystem = null;
    this.lastBuiltLength = -1;
    this.lastBuiltSystemAge = -1;
    this.lastBuiltVersion = -1;
  }

  insert(id: number, x: number, y: number, z: number, w: number): void {
    this.tempIds.push(id);
    this.tempX.push(x);
    this.tempY.push(y);
    this.tempZ.push(z);
    this.tempW.push(w);
    this.isBuilt = false;
  }

  remove(_id: number, _x: number, _y: number, _z: number, _w: number): void {
    // Spatial hash is rebuilt from scratch each tick. Direct removal is not needed,
    // but if called we flag it for rebuild.
    this.isBuilt = false;
  }

  /**
   * Optimized batch build from the system view directly.
   * Completely bypasses individual insert() calls, temp arrays, and pushes.
   */
  buildFromSystem(system: Root.ManifoldView): void {
    const sysVersion = system.version ?? 0;
    if (
      this.isBuilt &&
      this.lastBuiltSystem === system &&
      this.lastBuiltLength === system.length &&
      this.lastBuiltSystemAge === system.systemAge &&
      this.lastBuiltVersion === sysVersion
    ) {
      return;
    }

    this.clear();
    const n = system.length;

    // Count allocated atoms
    let count = 0;
    for (let j = 0; j < n; j++) {
      if (system.isAllocated(j)) count++;
    }

    this.ids = new Uint32Array(count);
    this.hashes = new Uint32Array(count);

    const packed = new Float64Array(count);
    let idx = 0;

    for (let j = 0; j < n; j++) {
      if (system.isAllocated(j)) {
        const cx = Math.floor(system.posX[j] / this.cellSize) | 0;
        const cy = Math.floor(system.posY[j] / this.cellSize) | 0;
        const cz = Math.floor(system.posZ[j] / this.cellSize) | 0;
        const cw = Math.floor(system.posW[j] / this.cellSize) | 0;
        const h = this.hashCoords(cx, cy, cz, cw);

        // Pack: hash in higher bits, ID in lower 24 bits
        packed[idx] = h * this.MULTIPLIER + j;
        idx++;
      }
    }

    // Native sort in optimized C++
    packed.sort();

    // Unpack
    for (let i = 0; i < count; i++) {
      const val = packed[i];
      const h = Math.floor(val / this.MULTIPLIER);
      const id = (val % this.MULTIPLIER) | 0;
      this.hashes[i] = h;
      this.ids[i] = id;
    }

    // Build contiguous cell offset ranges
    this.cellOffsets.clear();
    let start = 0;
    while (start < count) {
      const h = this.hashes[start];
      let end = start + 1;
      while (end < count && this.hashes[end] === h) {
        end++;
      }
      this.cellOffsets.set(h, [start, end - start]);
      start = end;
    }

    // Build 1D sorted index by posW using IEEE-754 bit representations
    this.sortedW = new Float32Array(count);
    this.sortedIdsByW = new Uint32Array(count);

    const packedW = new BigUint64Array(count);
    const f32 = new Float32Array(1);
    const u32 = new Uint32Array(f32.buffer);

    let idxW = 0;
    for (let j = 0; j < n; j++) {
      if (system.isAllocated(j)) {
        f32[0] = system.posW[j];
        packedW[idxW] = (BigInt(u32[0]) << 32n) | BigInt(j);
        idxW++;
      }
    }
    packedW.sort();

    for (let i = 0; i < count; i++) {
      const val = packedW[i];
      this.sortedIdsByW[i] = Number(val & 0xffffffffn);
      u32[0] = Number(val >> 32n);
      this.sortedW[i] = f32[0];
    }

    this.lastBuiltSystem = system;
    this.lastBuiltLength = system.length;
    this.lastBuiltSystemAge = system.systemAge;
    this.lastBuiltVersion = sysVersion;
    this.isBuilt = true;
  }

  build(): void {
    if (this.isBuilt) return;
    const n = this.tempIds.length;
    if (n === 0) {
      if (this.ids.length === 0) {
        this.isBuilt = true;
      }
      return;
    }

    this.ids = new Uint32Array(n);
    this.hashes = new Uint32Array(n);

    const packed = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const cx = Math.floor(this.tempX[i] / this.cellSize) | 0;
      const cy = Math.floor(this.tempY[i] / this.cellSize) | 0;
      const cz = Math.floor(this.tempZ[i] / this.cellSize) | 0;
      const cw = Math.floor(this.tempW[i] / this.cellSize) | 0;
      this.hashes[i] = this.hashCoords(cx, cy, cz, cw);
      packed[i] = this.hashes[i] * this.MULTIPLIER + this.tempIds[i];
    }

    packed.sort();

    for (let i = 0; i < n; i++) {
      const val = packed[i];
      this.hashes[i] = Math.floor(val / this.MULTIPLIER);
      this.ids[i] = (val % this.MULTIPLIER) | 0;
    }

    // Build contiguous cell offset ranges
    this.cellOffsets.clear();
    let start = 0;
    while (start < n) {
      const h = this.hashes[start];
      let end = start + 1;
      while (end < n && this.hashes[end] === h) {
        end++;
      }
      this.cellOffsets.set(h, [start, end - start]);
      start = end;
    }

    this.isBuilt = true;
  }

  nearest(
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    radius: number,
    view: Root.ManifoldView,
    activeAtoms?: Set<number>
  ): number {
    this.build();
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(qx / this.cellSize) | 0;
    const cy = Math.floor(qy / this.cellSize) | 0;
    const cz = Math.floor(qz / this.cellSize) | 0;
    const cw = Math.floor(qw / this.cellSize) | 0;

    let bestId = -1;
    let bestD2 = Infinity;

    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dw = -r; dw <= r; dw++) {
            const h = this.hashCoords(cx + dx, cy + dy, cz + dz, cw + dw);
            const range = this.cellOffsets.get(h);
            if (!range) continue;

            const [start, count] = range;
            for (let i = 0; i < count; i++) {
              const id = this.ids[start + i];
              if (activeAtoms !== undefined && !activeAtoms.has(id)) continue;

              const ddx = view.posX[id] - qx;
              const ddy = view.posY[id] - qy;
              const ddz = view.posZ[id] - qz;
              const ddw = view.posW[id] - qw;
              const d2 = ddx * ddx + ddy * ddy + ddz * ddz + ddw * ddw;

              if (d2 < bestD2) {
                bestD2 = d2;
                bestId = id;
              }
            }
          }
        }
      }
    }

    return bestD2 <= radius * radius ? bestId : -1;
  }

  candidatesInRadius(
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    radius: number
  ): number[] {
    this.build();
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(qx / this.cellSize) | 0;
    const cy = Math.floor(qy / this.cellSize) | 0;
    const cz = Math.floor(qz / this.cellSize) | 0;
    const cw = Math.floor(qw / this.cellSize) | 0;

    const result: number[] = [];
    this.candidatesInRadiusInto(qx, qy, qz, qw, radius, result);
    return result;
  }

  /**
   * Allocation-free variant of candidatesInRadius: writes the candidate ids into
   * a caller-owned, reused array (`out`), truncating it first. V8 retains the
   * backing store across `length = 0`, so the hot locomotion loop avoids a fresh
   * allocation on every force evaluation. Returns the candidate count.
   */
  candidatesInRadiusInto(
    qx: number,
    qy: number,
    qz: number,
    qw: number,
    radius: number,
    out: number[]
  ): number {
    this.build();
    out.length = 0;
    const r = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(qx / this.cellSize) | 0;
    const cy = Math.floor(qy / this.cellSize) | 0;
    const cz = Math.floor(qz / this.cellSize) | 0;
    const cw = Math.floor(qw / this.cellSize) | 0;

    let n = 0;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          for (let dw = -r; dw <= r; dw++) {
            const h = this.hashCoords(cx + dx, cy + dy, cz + dz, cw + dw);
            const range = this.cellOffsets.get(h);
            if (!range) continue;

            const [start, count] = range;
            for (let i = 0; i < count; i++) {
              out[n++] = this.ids[start + i];
            }
          }
        }
      }
    }
    out.length = n;
    return n;
  }

  private hashCoords(cx: number, cy: number, cz: number, cw: number): number {
    const p1 = 73856093;
    const p2 = 19349663;
    const p3 = 83492791;
    const p4 = 2246822519;
    return (
      (((cx * p1) ^ (cy * p2) ^ (cz * p3) ^ (cw * p4)) &
        (this.TABLE_SIZE - 1)) >>>
      0
    );
  }
}
