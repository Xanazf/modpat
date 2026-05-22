import { DOPAT_CONFIG, SYNTAX_ATTRACTORS, validateConfig } from "@config";
import { RingBuffer } from "ring-buffer-ts";

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
 * Bitmask enum for VAR slot roles within a code pattern.
 * Stored in system.slotType[] so the Mapper can perceive and attract toward
 * continuation points during geodesic path relaxation.
 */
export enum SlotType {
  None = 0,
  Leaf = 1 << 0, // concrete identifier or literal
  Body = 1 << 1, // sub-pattern continuation
  Condition = 1 << 2, // boolean expression
  Parameter = 1 << 3, // argument / parameter list
  TypeHint = 1 << 4, // type annotation
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
  /** Proactive curiosity signal spawned by motivation sources (CognitiveLoop). */
  Intent = 10,
  /** Binary arithmetic operators (+, -, *, /, plus, minus, times, divided). */
  Arithmetic = 11,
  /** Capability anchor: skill attractor that the Mapper navigates toward. */
  Capability = 12,
}

/**
 * Classifies a raw string token into its corresponding OperatorClass.
 *
 * @param token The string representation of the operator.
 * @returns The classified OperatorClass.
 */
function classifyOperatorToken(token: string): OperatorClass {
  const norm = token.trim().toLowerCase();

  // Arithmetic operators and identity binding symbols must be classified
  // before the SYNTAX_ATTRACTORS guard because "+", "-", "*", "/", "=" all
  // appear in STRUCTURES (needed for code synthesis landmark detection) and
  // would otherwise be silently promoted to SyntaxAnchor, preventing the
  // SVO split from firing on statements like "1+1=2".
  switch (norm) {
    case "+":
    case "-":
    case "*":
    case "/":
    case "%":
    case "plus":
    case "minus":
    case "times":
    case "multiplied":
    case "divided":
      return OperatorClass.Arithmetic;
    case "equals":
    case "=":
      return OperatorClass.IdentityShift;
  }

  // TypeScript Physicalized Code Synthesis: check syntax attractors.
  if (
    SYNTAX_ATTRACTORS.KEYWORDS.has(norm) ||
    SYNTAX_ATTRACTORS.STRUCTURES.has(norm)
  ) {
    return OperatorClass.SyntaxAnchor;
  }

  // TODO: allow the Mapper to expand this list
  // - needs "persistent identity" check;
  //  - operators are immutable across contexts;
  //  - if new_operator != immutable { new_operator = OperatorClass.None }
  // - possibly needs human review;
  switch (norm) {
    case "implies":
    case "=>":
    case "is":
    case "am": // first-person singular present of "to be"
    case "are":
    case "was":
    case "were":
    case "can":
    case "after": // ordinal succession - encodes the number-line "next" relation
    case "before": // ordinal precedence
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
    system: Root.ManifoldView,
    source: number,
    target: number
  ): number {
    const baseMass = system.mass[source];
    // If the target is the source itself, return full mass.
    if (target === 0) return baseMass;
    // Apply physically rigorous isotropic point source flux constant (1 / 4πr²)
    return baseMass / (4 * Math.PI * target * target);
  },

  /**
   * Determines if a precept has become "supermassive," potentially creating a logical singularity.
   * Supermassive precepts attract variables with extreme force but may collapse if the scope is too small.
   *
   * @param system The logical manifold.
   * @param id The index of the precept.
   * @returns True if the precept exceeds the blackbody limit.
   */
  isSupermassive(system: Root.ManifoldView, id: number): boolean {
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
  isUniversal(system: Root.ManifoldView, id: number): boolean {
    return (
      system.mass[id] < system.epsilon && system.scope[id] > system.maxilon
    );
  },
};

/**
 * Shared empty set returned by getIdsByScope() on a miss,
 * avoids per-call allocation.
 */
const _EMPTY_SET: ReadonlySet<number> = Object.freeze(new Set<number>());

/**
 * Byte-offset map describing how every typed-array view is laid out inside the
 * System's SharedArrayBuffer.  Workers reconstruct zero-copy views from this
 * record without importing the System class.
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

/** Compute buffer offsets for any maxPrecepts value (mirrors the System constructor). */
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
 * The System represents the core logical manifold: a contiguous block of memory
 * where logical "precepts" (prepositions, the "x" in "if x, then y")
 * are stored as physical entities within a dual-layer manifold of matter and coordinates.
 *
 * It acts as a Direct Memory Access (DMA) buffer for high-performance
 * topological calculations, allowing for efficient geodesic pathfinding.
 */
class System implements Root.ManifoldView {
  /** The contiguous block of memory (Logical Manifold) hosting all physical states. */
  public readonly buffer: SharedArrayBuffer;

  public updateRing = new RingBuffer<string>(10);

  /**
   * Scope-sequence index: stores (scope of first token, starting ID) for each
   * ingested sequence so the Resolver can do an O(SEQUENCE_INDEX_SIZE) ring scan
   * instead of an O(N × M) full manifold scan for the common forward-match case.
   * Newest entries overwrite oldest, mirrors thermodynamic forgetting semantics.
   */
  public sequenceRing = new RingBuffer<{ scope0: number; startId: number }>(
    DOPAT_CONFIG.SEQUENCE_INDEX_SIZE
  );

  public get patbuf(): string[] {
    return this.updateRing.toArray();
  }

  /** Current number of active precepts in the manifold. */
  public length: number;

  /** Monotonically-increasing version/mutation counter. */
  public version = 0;

  /** "Speed of Logic" - The rate at which information propagates through the manifold. */
  public readonly c: number = DOPAT_CONFIG.DELTA;

  /** Minimum possible number in any context (Epsilon). */
  public readonly epsilon: number = DOPAT_CONFIG.EPSILON;

  /** Maximum possible number in any context (Maxilon). */
  public readonly maxilon: number = DOPAT_CONFIG.MAXILON;

  /**
   * Monotonically-increasing system clock (seconds elapsed since boot).
   * Advanced by decay() on every tick.  Gives the Mapper/Resolver a stable
   * "now" reference so it can reason about before/after without being told.
   * Numeric literals use posW = value * 0.1 (the number line); all other
   * precepts get posW re-anchored to systemAge on each vault hit so the
   * Resolver's freshness signal stays bounded relative to the clock.
   */
  public systemAge = 0.0;

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

  /** Buffer view for 'allocated': tracks if a location is currently active. (U8) */
  public readonly allocated: Uint8Array;

  /** View for the Part Layer: stores pointers to atomic logical components (words). (U32) */
  public readonly PartLayer: Uint32Array;

  /** View for the Complex Layer: stores pointers to syllogisms or complex rules. (U32) */
  public readonly ComplexLayer: Uint32Array;

  /** View for logical classifications: identifies the OperatorClass of a precept. (U8) */
  public readonly operatorClass: Uint8Array;

  /** Slot-type flags for code-pattern VAR precepts, read by the Mapper's potential field. (U8) */
  public readonly slotType: Uint8Array;

  /** Free-list allocator, defaults to a plain array, swappable to a TMRFreeList via setAllocator(). */
  private freeList: Root.FreeList = [];

  /** F4 - scope → phi seed loaded from the persistent store at boot time. */
  private _phiSeedMap: Map<number, number> | null = null;

  /** Scope → set of currently allocated IDs: enables O(1) lookup by scope value. */
  private readonly scopeIndex = new Map<number, Set<number>>();

  /**
   * Initializes the logical manifold and allocates the underlying ArrayBuffer.
   */
  constructor() {
    validateConfig();
    this.length = 1; // Reserve index 0 as NULL
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

  /**
   * Replaces the free-list allocator, transferring any existing entries to the new one.
   * Called by ManifoldLifecycle to wire in TMR protection after construction.
   */
  public setAllocator(allocator: Root.FreeList): void {
    while (this.freeList.length > 0) {
      const id = this.freeList.pop();
      if (id !== undefined) allocator.push(id);
    }
    this.freeList = allocator;
  }

  /**
   * Returns all currently allocated IDs that carry the given scope value.
   * O(1) amortized, backed by the internal scope index.
   */
  public getIdsByScope(scope: number): ReadonlySet<number> {
    return this.scopeIndex.get(scope) ?? _EMPTY_SET;
  }

  public getScope(id: number): number {
    return this.scope[id];
  }

  /**
   * F4 - Registers the session φ seed map loaded from the persistent store.
   * Must be called before atoms are ingested so createLocation() can apply
   * the saved density boost to every matching scope on first creation.
   */
  public setPhiSeedMap(map: Map<number, number>): void {
    this._phiSeedMap = map.size > 0 ? map : null;
  }

  /**
   * Updates a precept's scope and keeps the scope index consistent.
   * Must be used instead of direct assignment whenever scope changes after creation.
   */
  public setScope(id: number, newScope: number): void {
    const oldScope = this.scope[id];
    if (oldScope === newScope) return;
    const oldSet = this.scopeIndex.get(oldScope);
    if (oldSet) {
      oldSet.delete(id);
      if (oldSet.size === 0) this.scopeIndex.delete(oldScope);
    }
    this.scope[id] = newScope;
    let newSet = this.scopeIndex.get(newScope);
    if (!newSet) {
      newSet = new Set();
      this.scopeIndex.set(newScope, newSet);
    }
    newSet.add(id);
    this.update(id, "setScope");
  }

  /**
   * Clears the manifold and resets all allocation pointers.
   */
  public reset(): void {
    this.length = 1; // Reserve index 0 as NULL, same as the constructor.
    this.freeList = [];
    this.scopeIndex.clear();
    // Clear entire buffer to zero.
    new Uint8Array(this.buffer).fill(0);
    // Clear view cache.
    this.viewCache.fill(undefined);

    // Reset sequence index, hydrated nodes are re-registered when next ingested
    this.sequenceRing = new RingBuffer<{ scope0: number; startId: number }>(
      DOPAT_CONFIG.SEQUENCE_INDEX_SIZE
    );

    this.pushRingUpdate(
      "reset",
      "length,freeList,buffer",
      `${this.length},${this.freeList.length},cleared`,
      ["system"]
    );
  }

  /**
   * Records the start of an ingested sequence in the scope-sequence index.
   * Called by atomizers after every complete ingestSequence so the Resolver's
   * ring fast-path can locate the sequence without a full manifold scan.
   *
   * @param scope0 - Scope of the first token in the sequence.
   * @param startId - System ID allocated for the first token.
   */
  public setSequenceStart(scope0: number, startId: number): void {
    this.sequenceRing.add({ scope0, startId });
  }

  public getSequenceEntries(): { scope0: number; startId: number }[] {
    return this.sequenceRing.toArray();
  }

  public getSequenceStart(id: number): number {
    // Look up the startId if the given id is a startId (or we could just return 0 if unsupported)
    // The plan requested this method, but its implementation depends on how it's used.
    // Given the ring buffer only stores startIds, we can check if it exists:
    const entries = this.sequenceRing.toArray();
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].startId === id) return entries[i].startId;
    }
    return -1;
  }

  /**
   * Push an update to the Update Ring Buffer
   */
  private pushRingUpdate(
    from: string,
    to: string,
    result: string,
    affected: string[]
  ) {
    const string = `${from}:${to} | [${result}] | ${affected}`;
    this.updateRing.add(string);
  }

  /**
   * Registers a new logical location (precept) within the manifold.
   *
   * @param initialMass The starting matter content.
   * @param initialScope The starting structural kind.
   * @returns The internal ID (index) of the new location.
   */
  public createLocation(
    initialMass: number,
    initialScope: number,
    from?: string
  ): number {
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
    this.allocated[id] = 1;
    this.mass[id] = initialMass;
    this.scope[id] = initialScope;
    this.decayRate[id] = 0.01; // Default decay rate.

    // Register in scope index.
    let scopeSet = this.scopeIndex.get(initialScope);
    if (!scopeSet) {
      scopeSet = new Set();
      this.scopeIndex.set(initialScope, scopeSet);
    }
    scopeSet.add(id);

    // Trigger update to calculate derived properties.
    this.update(id, from || "createLocation");

    // F4: if a session phi seed exists for this scope, boost mass (and thus
    // density) to at least the saved value so topology from prior sessions carries
    // forward. Only applied once at creation; subsequent ticks evolve freely.
    if (this._phiSeedMap) {
      const saved = this._phiSeedMap.get(initialScope);
      if (saved !== undefined && saved > this.density[id]) {
        this.mass[id] = saved * DOPAT_CONFIG.PHYSICS.PRECEPT_SCALE;
        this.density[id] = saved;
        this.checksum[id] = this.calculateChecksum(id);
      }
    }

    return id;
  }

  /**
   * Checks if a location is currently allocated.
   *
   * @param id The index of the precept.
   * @returns True if allocated.
   */
  public isAllocated(id: number): boolean {
    if (id < 0 || id >= this.length) return false;
    return this.allocated[id] === 1;
  }

  /**
   * Returns a location to the free list and clears its physical state.
   *
   * @param id The index of the precept to free.
   */
  public freeLocation(id: number, from?: string): void {
    if (id < 0 || id >= this.length) return;

    // Deregister from scope index before zeroing scope.
    const oldSet = this.scopeIndex.get(this.scope[id]);
    if (oldSet) {
      oldSet.delete(id);
      if (oldSet.size === 0) this.scopeIndex.delete(this.scope[id]);
    }

    this.allocated[id] = 0;

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
    this.slotType[id] = SlotType.None;
    this.PartLayer[id] = 0;
    this.ComplexLayer[id] = 0;

    // Invalidate view cache for this ID.
    const maxP = DOPAT_CONFIG.MAX_PRECEPTS;
    for (let bufferEnum = 0; bufferEnum < 14; bufferEnum++) {
      this.viewCache[bufferEnum * maxP + id] = undefined;
    }

    this.freeList.push(id);
    this.pushRingUpdate(
      from || "freeLocation",
      `system[${id}]`,
      `value@${id}=0`,
      [`system[${id}]`]
    );
  }

  /**
   * Re-calculates derived physical properties for a specific ID.
   * Derived properties sit at the specific cross-dimensional intersections.
   *
   * @param id The index of the precept to update.
   */
  public update(id: number, from?: string): void {
    if (from !== "reinforce") {
      this.version++;
    }
    const m = this.mass[id];
    // Scope is now a pure identity tag (symbolIdx); use the fixed PRECEPT_SCALE
    // constant instead so derived properties stay numerically stable regardless
    // of which symbol index was assigned.
    const s = DOPAT_CONFIG.PHYSICS.PRECEPT_SCALE;
    const d = this.depth[id];
    const t = this.time[id];

    // Normalizing scale to maintain finite bounds for derived units
    const physicalScale = 1.0;

    // Matter Layer Intersection (posX:posY)
    this.density[id] = Math.min((m / s) * physicalScale, this.maxilon);
    // Temporal Layer Intersection (posW:posY)
    this.entropyRate[id] = Math.min((t / s) * physicalScale, this.maxilon);
    // Energy Layer Intersection (posZ:posX)
    this.potency[id] = Math.min(
      (d / Math.max(Math.abs(m), this.epsilon)) * physicalScale,
      this.maxilon
    );
    // Intensity Layer Intersection (posZ:posY)
    this.intensity[id] = Math.min((d / s) * physicalScale, this.maxilon);

    // Update integrity checksum.
    // M2 note: CRC-32 here dominates decay() cost. The right fix requires splitting
    // update() into _updateDerived + _updateChecksum so decay() can call only derived
    // property recalculation in the inner loop and batch checksums after. Deferred.
    this.checksum[id] = this.calculateChecksum(id);

    // Push Ring Buffer Update
    this.pushRingUpdate(
      from || "update",
      `derivatives[${id}]`,
      `checksum@${id}=${this.checksum[id]}`,
      [
        `density[${id}]`,
        `entropyRate[${id}]`,
        `potency[${id}]`,
        `intensity[${id}]`,
        `checksum[${id}]`,
      ]
    );
  }

  /**
   * Calculates a physical hash of the state for integrity verification.
   * Combines all primary dimensions with unique weights.
   *
   * @param id The index of the precept.
   * @returns The calculated checksum.
   */
  private calculateChecksum(id: number): number {
    const data = new Float64Array([
      this.mass[id] || 0,
      this.scope[id] || 0,
      this.depth[id] || 0,
      this.time[id] || 0,
      this.posX[id] || 0,
      this.posY[id] || 0,
      this.posZ[id] || 0,
      this.posW[id] || 0,
    ]);
    const bytes = new Uint8Array(data.buffer);
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      let byte = bytes[i];
      for (let j = 0; j < 8; j++) {
        const bit = (crc ^ byte) & 1;
        crc >>>= 1;
        if (bit) crc ^= 0xedb88320;
        byte >>>= 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
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
      if (!this.isAllocated(i)) continue;
      if (!this.validate(i)) {
        corrupted.push(i);
      }
    }
    return corrupted;
  }

  /**
   * Temporal Manifold Dynamics: simulates the passage of time and logical friction.
   * Matter decays exponentially while temporal freshness (posW) fades,
   * and low-mass precepts drift toward the manifold origin.
   *
   * @param deltaTime Elapsed simulation time in milliseconds.
   */
  public decay(deltaTime: number): void {
    const dtSec = deltaTime / 1000;
    const VACUUM_THRESHOLD = DOPAT_CONFIG.DRIFT_THRESHOLD * 0.001;
    const CRITICAL_ENTROPY = 100.0;

    // Advance the system's internal clock.
    this.systemAge += dtSec;

    // posW freshness decay factor for non-eternal precepts.
    const ageFactor = Math.exp(-DOPAT_CONFIG.PHYSICS.AGE_DECAY_RATE * dtSec);

    for (let i = 0; i < this.length; i++) {
      if (!this.isAllocated(i)) continue;

      const rate = this.decayRate[i];

      // Eternal precepts (decayRate === 0, e.g. numeric literals) keep their
      // posW stable as number-line coordinates and never lose mass.
      if (rate === 0) continue;

      // Age accumulates (used for entropyRate = time / PRECEPT_SCALE).
      this.time[i] += rate * dtSec;
      // Mass decays exponentially.
      this.mass[i] *= Math.exp(-rate * dtSec);

      // Thermodynamic Forgetting: prune heat-dead nodes.
      if (
        Math.abs(this.mass[i]) < VACUUM_THRESHOLD &&
        this.entropyRate[i] > CRITICAL_ENTROPY
      ) {
        this.freeLocation(i, "thermodynamic_pruning");
        continue;
      }

      // Temporal freshness decay: posW fades so stale concepts lose their
      // energy advantage in the Resolver's forward pass over time.
      // Eternal (decayRate=0) precepts are skipped above - their posW encodes
      // a stable coordinate (the number line) and must not drift.
      this.posW[i] = Math.max(0, this.posW[i] * ageFactor);

      // Spatial drift: low-mass precepts lose their positional anchor.
      if (Math.abs(this.mass[i]) < DOPAT_CONFIG.DRIFT_THRESHOLD) {
        const driftDamping = Math.exp(-0.1 * dtSec);
        this.posX[i] *= driftDamping;
        this.posY[i] *= driftDamping;
        this.posZ[i] *= driftDamping;
      }

      this.update(i, "decay");
    }
  }

  /**
   * Refreshes the temporal freshness (posW) of every precept that carries the
   * given scope, setting it to AGE_FRESHNESS (1.0).
   *
   * Call this whenever a concept participates in a successful inference - vault
   * hit, bridge resolution, or explicit user reference.  The freshness decays
   * back toward zero between ticks, giving recently-used concepts a head start
   * in the Resolver's forward-energy seeding.
   */
  public refreshConceptAge(scope: number): void {
    for (const id of this.scopeIndex.get(scope) ?? []) {
      if (this.decayRate[id] === 0) continue; // eternal - number-line coordinate is stable
      this.posW[id] = this.systemAge;
      this.update(id);
    }
  }

  /**
   * Refreshes temporal freshness (posW) for the given specific precept IDs
   * only.  Use this instead of refreshConceptAge when the caller knows exactly
   * which atoms participated - it avoids refreshing every precept that shares
   * the same scope (which includes unrelated stopword precepts).
   */
  public refreshConceptAgeForIds(ids: ArrayLike<number>): void {
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!this.isAllocated(id)) continue;
      if (this.decayRate[id] === 0) continue; // eternal - number-line coordinate is stable
      this.posW[id] = this.systemAge;
      this.update(id);
    }
  }

  /** Returns the buffer layout descriptor for worker reconstruction. */
  public getLayout(): ManifoldLayout {
    return computeManifoldLayout(
      DOPAT_CONFIG.MAX_PRECEPTS,
      this.c,
      this.epsilon,
      this.maxilon
    );
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
      this.update(target, "signal");
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
    snapshot(system: Root.ManifoldView): Promise<void>;
  }): Promise<void> {
    await persistence.snapshot(this);
  }

  /**
   * Hydrates the manifold state from a persistent store.
   *
   * @param persistence The persistence manager providing the hydrate capability.
   */
  public async hydrate(persistence: {
    hydrate(system: Root.ManifoldView): Promise<void>;
  }): Promise<void> {
    await persistence.hydrate(this);
  }
}

/**
 * A mutable reference cell wrapping a System instance.
 * Components that hold a SystemRef always dereference via `.current`, so
 * ManifoldLifecycle can atomically redirect every holder to a new System in a
 * single call to `swap()`, no per-component update required.
 */
class SystemRef {
  private _system: Root.ManifoldView;
  constructor(system: Root.ManifoldView) {
    this._system = system;
  }
  get current(): Root.ManifoldView {
    return this._system;
  }
  get readOnly(): Root.ReadonlyManifoldView {
    return this._system;
  }
  swap(system: Root.ManifoldView): void {
    this._system = system;
  }
}

export { classifyOperatorToken, LogicOperations, SystemRef, TargetBuffer };
export default System;
