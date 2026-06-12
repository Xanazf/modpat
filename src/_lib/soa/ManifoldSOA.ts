/**
 * Struct-of-arrays primitive backing the logical manifold: a single
 * SharedArrayBuffer sliced into one typed-array view per precept property.
 * Workers reconstruct zero-copy views from the same layout via
 * `computeManifoldLayout()` without importing this class.
 */
export interface ManifoldLayout {
  maxPrecepts: number;
  byteLength: number;
  c: number;
  epsilon: number;
  maxilon: number;
  offsets: {
    mass: number;
    scope: number;
    depth: number;
    time: number;
    posX: number;
    posY: number;
    posZ: number;
    posW: number;
    density: number;
    entropyRate: number;
    potency: number;
    intensity: number;
    decayRate: number;
    checksum: number;
    PartLayer: number;
    ComplexLayer: number;
    operatorClass: number;
    allocated: number;
    slotType: number;
  };
}

/** Compute buffer offsets for any maxPrecepts value (mirrors ManifoldSOA's constructor). */
export function computeManifoldLayout(
  maxPrecepts: number,
  c: number,
  epsilon: number,
  maxilon: number
): ManifoldLayout {
  const bF64 = maxPrecepts * 8;
  const bU32 = maxPrecepts * 4;
  const bU8 = maxPrecepts * 1;
  const base14 = bF64 * 14;
  const base2U32 = base14 + bU32 * 2;
  return {
    maxPrecepts,
    byteLength: base14 + bU32 * 2 + bU8 * 3,
    c,
    epsilon,
    maxilon,
    offsets: {
      mass: 0,
      scope: bF64,
      depth: 2 * bF64,
      time: 3 * bF64,
      posX: 4 * bF64,
      posY: 5 * bF64,
      posZ: 6 * bF64,
      posW: 7 * bF64,
      density: 8 * bF64,
      entropyRate: 9 * bF64,
      potency: 10 * bF64,
      intensity: 11 * bF64,
      decayRate: 12 * bF64,
      checksum: 13 * bF64,
      PartLayer: base14,
      ComplexLayer: base14 + bU32,
      operatorClass: base2U32,
      allocated: base2U32 + bU8,
      slotType: base2U32 + 2 * bU8,
    },
  };
}

/**
 * Allocates the manifold's SharedArrayBuffer and slices it into one typed-array
 * view per precept property (14 F64, 2 U32, 3 U8), in the order described by
 * `computeManifoldLayout()`.
 */
export class ManifoldSOA {
  public readonly buffer: SharedArrayBuffer;

  public readonly mass: Float64Array;
  public readonly scope: Float64Array;
  public readonly depth: Float64Array;
  public readonly time: Float64Array;
  public readonly posX: Float64Array;
  public readonly posY: Float64Array;
  public readonly posZ: Float64Array;
  public readonly posW: Float64Array;
  public readonly density: Float64Array;
  public readonly entropyRate: Float64Array;
  public readonly potency: Float64Array;
  public readonly intensity: Float64Array;
  public readonly decayRate: Float64Array;
  public readonly checksum: Float64Array;

  public readonly PartLayer: Uint32Array;
  public readonly ComplexLayer: Uint32Array;

  public readonly operatorClass: Uint8Array;
  public readonly allocated: Uint8Array;
  public readonly slotType: Uint8Array;

  constructor(maxP: number) {
    const bytesF64 = Float64Array.BYTES_PER_ELEMENT; // 8
    const bytesU32 = Uint32Array.BYTES_PER_ELEMENT; // 4
    const bytesU8 = Uint8Array.BYTES_PER_ELEMENT; // 1

    const blockF64 = maxP * bytesF64;
    const blockU32 = maxP * bytesU32;
    const blockU8 = maxP * bytesU8;

    // Calculate total buffer size required for all views.
    const totalBytes =
      blockF64 * 14 + // mass, scope, depth, time, posX, posY, posZ, posW, density, entropyRate, potency, intensity, decayRate, checksum
      blockU32 * 2 + // PartLayer, ComplexLayer
      blockU8 * 3; // operatorClass, allocated, slotType

    this.buffer = new SharedArrayBuffer(totalBytes);

    let offset = 0;

    // Map 64-bit physical properties into the buffer.
    this.mass = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.scope = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.depth = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.time = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.posX = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.posY = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.posZ = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.posW = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.density = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.entropyRate = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.potency = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.intensity = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.decayRate = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;
    this.checksum = new Float64Array(this.buffer, offset, maxP);
    offset += blockF64;

    // Map 32-bit structural layers into the buffer.
    this.PartLayer = new Uint32Array(this.buffer, offset, maxP);
    offset += blockU32;
    this.ComplexLayer = new Uint32Array(this.buffer, offset, maxP);
    offset += blockU32;

    // Map 8-bit logical classifications into the buffer.
    this.operatorClass = new Uint8Array(this.buffer, offset, maxP);
    offset += blockU8;

    this.allocated = new Uint8Array(this.buffer, offset, maxP);
    offset += blockU8;

    this.slotType = new Uint8Array(this.buffer, offset, maxP);
    offset += blockU8;
  }
}
