import { DOPAT_CONFIG, SYNTAX_ATTRACTORS } from "@config";

/**
 * Enumeration of physical property buffers within the logical manifold.
 * These buffers correspond to the different dimensions of a logical precept's existence.
 */
enum TargetBuffer {
  /** Matter: The logical importance or content of posX. */
  Mass = 0,
  /** Kind: The structural identifier or content of posY. */
  Scope = 1,
  /** Energy: The logical potential or content of posZ. */
  Depth = 2,
  /** Age: The temporal state or content of posW. */
  Time = 3,
  /** Topological X-coordinate (Matter). */
  PosX = 4,
  /** Topological Y-coordinate (Kind). */
  PosY = 5,
  /** Topological Z-coordinate (Energy). */
  PosZ = 6,
  /** Topological W-coordinate (Age). */
  PosW = 7,
  /** Matter Density (Mass / Scope) at posX:posY. */
  Density = 8,
  /** Temporal Decay Rate (Time / Scope) at posW:posY. */
  EntropyRate = 9,
  /** Logical Potency (Depth / Mass) at posZ:posX. */
  Potency = 10,
  /** Logical Intensity (Depth / Scope) at posZ:posY. */
  Intensity = 11,
  /** Per-precept rate of logical decay. */
  DecayRate = 12,
  /** Physical hash of the precept's state for integrity. */
  Checksum = 13,
}

/**
 * Classification of logical operators as "massive bodies" that attract and define
 * the relationships between variables in the heat field.
 */
export enum OperatorClass {
  /** No operator assigned. */
  None = 0,
  /** Operators that shift the identity or state (e.g., "is", "becomes"). */
  IdentityShift = 1,
  /** Logical conjunctions (e.g., "and", "but"). */
  Conjunction = 2,
  /** A logical sink or conclusion point (e.g., "therefore"). */
  Sink = 3,
  /** Existential or universal quantifiers. */
  Quantifier = 4,
  /** Modifiers that define the scope of a statement (e.g., "all", "some"). */
  Modifier = 5,
  /** Logical negation or inversion. */
  Inversion = 6,
  /** Action-oriented operators that define events or transformations. */
  Action = 7,
  /** Query-based operators used for logical interrogation. */
  Query = 8,
  /** Syntactic landmarks for physicalized code synthesis. */
  SyntaxAnchor = 9,
}

/**
 * Classifies a raw string token into its corresponding OperatorClass.
 *
 * @param token The string representation of the operator.
 * @returns The classified OperatorClass.
 */
function classifyOperatorToken(token: string): OperatorClass {
  const norm = token.trim().toLowerCase();

  // TypeScript Physicalized Code Synthesis: check syntax attractors first.
  if (
    SYNTAX_ATTRACTORS.KEYWORDS.has(norm) ||
    SYNTAX_ATTRACTORS.STRUCTURES.has(norm)
  ) {
    return OperatorClass.SyntaxAnchor;
  }

  // TODO: allow the Mapper to expand this list
  // - needs "persistent identity" check;
  //  - operators are immutable across contexts;
  //  - if new_operator != immutable { new_operator != OperatorClass }
  // - possibly needs human review;
  switch (norm) {
    case "implies":
    case "=>":
    case "is":
    case "are":
    case "was":
    case "were":
    case "can":
      return OperatorClass.IdentityShift;
    case "&&":
    case "and":
    case "but":
      return OperatorClass.Conjunction;
    case "|-":
    case "then":
    case "therefore":
      return OperatorClass.Sink;
    case "exists":
      return OperatorClass.Quantifier;
    case "all":
    case "for all":
    case "every":
    case "some":
    case "any":
      return OperatorClass.Modifier;
    case "not":
    case "!":
    case "didn't":
    case "did not":
    case "cannot":
      return OperatorClass.Inversion;
    case "do":
    case "did":
    case "born":
    case "died":
    case "invented":
    case "discovered":
      return OperatorClass.Action;
    case "how":
    case "who":
    case "what":
    case "where":
    case "when":
    case "why":
      return OperatorClass.Query;
    default:
      return OperatorClass.None;
  }
}

/**
 * Internal mapping of TargetBuffer indices to property keys on the System class.
 */
const BufferMap: (
  | "mass"
  | "scope"
  | "depth"
  | "time"
  | "posX"
  | "posY"
  | "posZ"
  | "posW"
  | "density"
  | "entropyRate"
  | "potency"
  | "intensity"
  | "decayRate"
  | "checksum"
)[] = [
  "mass",
  "scope",
  "depth",
  "time",
  "posX",
  "posY",
  "posZ",
  "posW",
  "density",
  "entropyRate",
  "potency",
  "intensity",
  "decayRate",
  "checksum",
];

/**
 * A collection of mathematical operations for analyzing the logical manifold.
 */
const LogicOperations = {
  /**
   * Calculates the inverse square of a precept's mass relative to a target distance.
   * Simulates the "gravitational" pull of a logical entity.
   *
   * @param system The logical manifold to query.
   * @param source The index of the source precept.
   * @param target The distance (or target index) to calculate against.
   * @returns The resulting attenuated logical mass.
   */
  calculateInverseSquare(
    system: System,
    source: number,
    target: number
  ): number {
    const baseMass = system.mass[source];
    // If the target is the source itself, return full mass.
    if (target === 0) return baseMass;
    // Apply inverse square law with a scaling factor of sqrt(PI).
    return baseMass * (Math.sqrt(Math.PI) / target ** 2);
  },

  /**
   * Determines if a precept has become "supermassive," potentially creating a logical singularity.
   * Supermassive precepts attract variables with extreme force but may collapse if the scope is too small.
   *
   * @param system The logical manifold.
   * @param id The index of the precept.
   * @returns True if the precept exceeds the blackbody limit.
   */
  isSupermassive(system: System, id: number): boolean {
    return (
      system.mass[id] > DOPAT_CONFIG.BLACKBODY_LIMIT && system.scope[id] <= 1
    );
  },

  /**
   * Determines if a precept is "universal," having infinite scope and minimal individual mass.
   *
   * @param system The logical manifold.
   * @param id The index of the precept.
   * @returns True if the precept qualifies as universal.
   */
  isUniversal(system: System, id: number): boolean {
    return (
      system.mass[id] < system.epsilon && system.scope[id] > system.maxilon
    );
  },
};

/**
 * The System represents the core logical manifold: a contiguous block of memory
 * where logical "precepts" are stored as physical entities within a dual-layer
 * manifold of matter and coordinates.
 *
 * It acts as a Direct Memory Access (DMA) buffer for high-performance
 * topological calculations, allowing for efficient geodesic pathfinding.
 */
class System {
  /** The contiguous block of memory (Logical Manifold) hosting all physical states. */
  public readonly buffer: ArrayBuffer;

  /** Current number of active precepts in the manifold. */
  public length: number;

  /** "Speed of Logic" - The rate at which information propagates through the manifold. */
  public readonly c: number = DOPAT_CONFIG.DELTA;

  /** Minimal resolution limit for logical calculations (Epsilon). */
  public readonly epsilon: number = DOPAT_CONFIG.EPSILON;

  /** Maximum stability threshold before a precept collapses or saturates (Maxilon). */
  public readonly maxilon: number = DOPAT_CONFIG.MAXILON;

  /** Cache for reactive property signals to prevent redundant allocations. */
  private viewCache: (Root.Signal | undefined)[] = [];

  /** Matter: represents logical importance or content of posX. (F64) */
  public readonly mass: Float64Array;

  /** Kind: represents structural reach or content of posY. (F64) */
  public readonly scope: Float64Array;

  /** Energy: represents logical potential or content of posZ. (F64) */
  public readonly depth: Float64Array;

  /** Age: represents the temporal state or content of posW. (F64) */
  public readonly time: Float64Array;

  /** Buffer view for 'posX': matter coordinate. (F64) */
  public readonly posX: Float64Array;

  /** Buffer view for 'posY': kind coordinate. (F64) */
  public readonly posY: Float64Array;

  /** Buffer view for 'posZ': energy coordinate. (F64) */
  public readonly posZ: Float64Array;

  /** Buffer view for 'posW': age coordinate. (F64) */
  public readonly posW: Float64Array;

  /** Buffer view for 'density': mass / scope. (F64) */
  public readonly density: Float64Array;

  /** Buffer view for 'entropyRate': time / scope. (F64) */
  public readonly entropyRate: Float64Array;

  /** Buffer view for 'potency': depth / mass. (F64) */
  public readonly potency: Float64Array;

  /** Buffer view for 'intensity': depth / scope. (F64) */
  public readonly intensity: Float64Array;

  /** Buffer view for 'decayRate': custom rate of logical decay per precept. (F64) */
  public readonly decayRate: Float64Array;

  /** Buffer view for 'checksum': physical hash of the precept's state for integrity. (F64) */
  public readonly checksum: Float64Array;

  /** View for the Part Layer: stores pointers to atomic logical components (words). (U32) */
  public readonly PartLayer: Uint32Array;

  /** View for the Complex Layer: stores pointers to syllogisms or complex rules. (U32) */
  public readonly ComplexLayer: Uint32Array;

  /** View for logical classifications: identifies the OperatorClass of a precept. (U8) */
  public readonly operatorClass: Uint8Array;

  /** List of available indices in the manifold for reuse after deallocation. */
  private freeList: number[] = [];

  /**
   * Initializes the logical manifold and allocates the underlying ArrayBuffer.
   */
  constructor() {
    this.length = 0;
    const maxP = DOPAT_CONFIG.MAX_PRECEPTS;

    // View Cache initialization (14 properties * max precepts)
    this.viewCache = new Array(maxP * 14).fill(undefined);

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
      blockU8;

    this.buffer = new ArrayBuffer(totalBytes);

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
  }

  /**
   * Clears the manifold and resets all allocation pointers.
   */
  public reset(): void {
    this.length = 0;
    this.freeList = [];
  }

  /**
   * Registers a new logical location (precept) within the manifold.
   *
   * @param initialMass The starting matter content.
   * @param initialScope The starting structural kind.
   * @returns The internal ID (index) of the new location.
   */
  public createLocation(initialMass: number, initialScope: number): number {
    let id: number;
    // Check for available indices in the free list to reuse memory.
    if (this.freeList.length > 0) {
      id = this.freeList.pop()!;
    } else {
      // Otherwise, extend the manifold if capacity allows.
      if (this.length >= DOPAT_CONFIG.MAX_PRECEPTS) {
        throw new Error(
          `System capacity reached: ${DOPAT_CONFIG.MAX_PRECEPTS} precepts`
        );
      }
      id = this.length++;
    }

    // Set initial physical state.
    this.mass[id] = initialMass;
    this.scope[id] = initialScope;
    this.decayRate[id] = 0.01; // Default decay rate.

    // Trigger update to calculate derived properties.
    this.update(id);
    return id;
  }

  /**
   * Returns a location to the free list and clears its physical state.
   *
   * @param id The index of the precept to free.
   */
  public freeLocation(id: number): void {
    if (id < 0 || id >= this.length) return;

    // Zero out all physical properties to prevent stale data.
    this.mass[id] = 0;
    this.scope[id] = 0;
    this.depth[id] = 0;
    this.time[id] = 0;
    this.posX[id] = 0;
    this.posY[id] = 0;
    this.posZ[id] = 0;
    this.posW[id] = 0;
    this.density[id] = 0;
    this.entropyRate[id] = 0;
    this.potency[id] = 0;
    this.intensity[id] = 0;
    this.decayRate[id] = 0;
    this.checksum[id] = 0;
    this.operatorClass[id] = OperatorClass.None;

    this.freeList.push(id);
  }

  /**
   * Re-calculates derived physical properties for a specific ID.
   * Derived properties sit at the specific cross-dimensional intersections.
   *
   * @param id The index of the precept to update.
   */
  public update(id: number): void {
    const m = this.mass[id];
    const s = Math.max(this.scope[id], this.epsilon);
    const d = this.depth[id];
    const t = this.time[id];

    // Matter Layer Intersection (posX:posY)
    this.density[id] = Math.min(m / s, this.maxilon);
    // Temporal Layer Intersection (posW:posY)
    this.entropyRate[id] = Math.min(t / s, this.maxilon);
    // Energy Layer Intersection (posZ:posX)
    this.potency[id] = Math.min(d / Math.max(m, this.epsilon), this.maxilon);
    // Intensity Layer Intersection (posZ:posY)
    this.intensity[id] = Math.min(d / s, this.maxilon);

    // Update integrity checksum.
    this.checksum[id] = this.calculateChecksum(id);
  }

  /**
   * Calculates a physical hash of the state for integrity verification.
   * Combines all primary dimensions with unique weights.
   *
   * @param id The index of the precept.
   * @returns The calculated checksum.
   */
  private calculateChecksum(id: number): number {
    const m = this.mass[id] || 0;
    const s = this.scope[id] || 0;
    const d = this.depth[id] || 0;
    const t = this.time[id] || 0;
    const x = this.posX[id] || 0;
    const y = this.posY[id] || 0;
    const z = this.posZ[id] || 0;
    const w = this.posW[id] || 0;

    return (
      m * 0.1 +
      s * 0.2 +
      d * 0.3 +
      t * 0.4 +
      x * 0.5 +
      y * 0.6 +
      z * 0.7 +
      w * 0.8
    );
  }

  /**
   * Validates the integrity of a precept's physical properties.
   * Detects corruption or logical singularities that could destabilize the manifold.
   *
   * @param id The index of the precept to validate.
   * @returns True if the precept is stable and valid.
   */
  public validate(id: number): boolean {
    if (id < 0 || id >= this.length) return false;
    const current = this.checksum[id];
    const expected = this.calculateChecksum(id);

    // Check if the physical state matches its checksum.
    if (Math.abs(current - expected) >= this.epsilon) {
      return false;
    }

    // Detect Singularities: High matter with near-zero kind.
    const m = this.mass[id];
    const s = this.scope[id];
    if (m > DOPAT_CONFIG.BLACKBODY_LIMIT && s <= this.epsilon) {
      return false;
    }

    return true;
  }

  /**
   * Performs a full system integrity check across the entire manifold.
   *
   * @returns Array of IDs with corrupted or unstable physical states.
   */
  public checkIntegrity(): number[] {
    const corrupted: number[] = [];
    for (let i = 0; i < this.length; i++) {
      if (!this.validate(i)) {
        corrupted.push(i);
      }
    }
    return corrupted;
  }

  /**
   * Temporal Manifold Dynamics: simulates the passage of time and logical friction.
   * Matter decays exponentially while Age (time) increases based on per-precept rate.
   *
   * @param deltaTime Elapsed simulation time.
   */
  public decay(deltaTime: number): void {
    for (let i = 0; i < this.length; i++) {
      // Skip deallocated locations.
      if (this.mass[i] === 0 && this.scope[i] === 0) continue;

      const rate = this.decayRate[i] || 0.01;

      // Age increases based on the decay constant.
      this.time[i] += rate * deltaTime;
      // Matter decays over time.
      this.mass[i] *= Math.exp(-rate * deltaTime);

      // Natural Drift: dead or forgotten precepts drift towards the manifold origin.
      if (Math.abs(this.mass[i]) < 100.0) {
        this.posX[i] *= 0.9;
        this.posY[i] *= 0.9;
        this.posZ[i] *= 0.9;
        this.posW[i] *= 0.9;
      }

      // Re-calculate derived properties after decay.
      this.update(i);
    }
  }

  /**
   * Creates a reactive signal (get/set pair) for a specific physical property of a precept.
   * Signals are cached to allow efficient reactivity in the heat field.
   *
   * @param bufferEnum The physical property dimension to target.
   * @param target The index of the precept.
   * @returns A Signal tuple [getter, setter].
   */
  public createSignal(bufferEnum: TargetBuffer, target: number): Root.Signal {
    const maxP = DOPAT_CONFIG.MAX_PRECEPTS;
    const propertyKey = BufferMap[bufferEnum];

    // Compute unique cache index for this property/precept pair.
    const cacheIndex = bufferEnum * maxP + target;
    let signal = this.viewCache[cacheIndex];

    if (signal) return signal;

    const get = () => this[propertyKey][target];
    const set = (v: number): number => {
      this[propertyKey][target] = v;
      // Trigger update when a property is modified to maintain physical consistency.
      this.update(target);
      return this[propertyKey][target];
    };

    signal = [get, set];
    this.viewCache[cacheIndex] = signal;

    return signal;
  }

  /**
   * Serializes the current state of the manifold into a persistent store.
   *
   * @param persistence The persistence manager capable of taking a snapshot.
   */
  public async snapshot(persistence: {
    snapshot(system: System): Promise<void>;
  }): Promise<void> {
    await persistence.snapshot(this);
  }

  /**
   * Hydrates the manifold state from a persistent store.
   *
   * @param persistence The persistence manager providing the hydrate capability.
   */
  public async hydrate(persistence: {
    hydrate(system: System): Promise<void>;
  }): Promise<void> {
    await persistence.hydrate(this);
  }
}

export { LogicOperations, TargetBuffer, classifyOperatorToken };
export default System;
