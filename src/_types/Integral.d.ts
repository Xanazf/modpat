// INFO:
// P = NP
//  - every solution should contain its proof;

// NOTE:
// Float64Array = (-1.8 * 10^308) to (1.8 * 10^308);
//  - or: -1.8e308 to 1.8e308;
// Float32Array = (-3.4 * 10^38) to (3.4 * 10^38);
//  - or: -3.4e38 to 3.4e38;
// ---
// Uint32Array = 0 to 4294967295
// Int32Array = -2147483648 to 2147483647

declare namespace Root {
  type Accessor = () => number;
  type Setter = (value: number) => number;
  type Signal = [get: Accessor, set: Setter];

  /** Injectable free-list allocator - satisfied by plain number[] or TMRFreeList. */
  interface FreeList {
    pop(): number | undefined;
    push(id: number): void;
    readonly length: number;
  }

  // Valid buffers for createView
  type ComplexF64Array = {
    real: Float64Array;
    imag: Float64Array;
  };

  type TargetUnion = "mass" | "time" | "density" | number;

  interface ManifoldView {
    readonly length: number;

    // Clock speed or frame delta
    // speed of information;
    // ~16.67ms;
    readonly c: number;

    // Constants
    readonly epsilon: number;
    readonly maxilon: number;

    /** Monotonically-increasing system clock (seconds elapsed since boot).
     *  Advanced by decay(). Gives the Mapper/Resolver a "now" to reason against. */
    systemAge: number;

    // Updates
    update(id: number, from?: string): void;

    // Buffers
    readonly patbuf: string[];

    // Physical properties
    mass: Float64Array;
    scope: Float64Array;
    depth: Float64Array;
    time: Float64Array;

    // Position buffers (read/write)
    posX: Float64Array;
    posY: Float64Array;
    posZ: Float64Array;
    posW: Float64Array;

    // Reactive combinations
    // NOTE: ideally, extended on the fly
    // via combining the 4 basic physical properties
    density: Float64Array;
    entropyRate: Float64Array;
    potency: Float64Array;
    intensity: Float64Array;
    decayRate: Float64Array;

    checksum: Float64Array;

    // Ops pointer byte arrays
    allocated: Uint8Array;
    operatorClass: Uint8Array;
    slotType: Uint8Array;

    // Layer pointers
    PartLayer: Uint32Array;
    ComplexLayer: Uint32Array;

    // Scope index: enforced write path
    getScope(id: number): number;
    setScope(id: number, scope: number): void; // updates scope index
    getIdsByScope(scope: number): ReadonlySet<number>;

    // Sequence ring: enforced write path
    getSequenceStart(id: number): number;
    setSequenceStart(scope0: number, startId: number): void;
    getSequenceEntries(): { scope0: number; startId: number }[];

    // Allocation
    createLocation(
      localMass: number,
      localScope: number,
      from?: string
    ): number;
    freeLocation(id: number, from?: string): void;

    // Check if a location is currently allocated
    isAllocated(id: number): boolean;

    // Temporal freshness
    /** Re-anchors posW to systemAge for every precept that carries this scope. */
    refreshConceptAge(scope: number): void;
    /** Re-anchors posW to systemAge for exactly the supplied precept IDs only. */
    refreshConceptAgeForIds(ids: ArrayLike<number>): void;
    /** Advances systemAge, decays mass, and fades posW for non-eternal precepts. */
    decay(deltaTime: number): void;
  }

  interface ReadonlyManifoldView
    extends Omit<
      ManifoldView,
      | "posX"
      | "posY"
      | "posZ"
      | "posW"
      | "mass"
      | "scope"
      | "depth"
      | "time"
      | "density"
      | "entropyRate"
      | "potency"
      | "intensity"
      | "decayRate"
      | "checksum"
      | "allocated"
      | "operatorClass"
      | "slotType"
      | "PartLayer"
      | "ComplexLayer"
      | "setScope"
      | "setSequenceStart"
      | "createLocation"
      | "freeLocation"
      | "update"
    > {
    readonly mass: Readonly<Float64Array>;
    readonly scope: Readonly<Float64Array>;
    readonly depth: Readonly<Float64Array>;
    readonly time: Readonly<Float64Array>;

    readonly posX: Readonly<Float64Array>;
    readonly posY: Readonly<Float64Array>;
    readonly posZ: Readonly<Float64Array>;
    readonly posW: Readonly<Float64Array>;

    readonly density: Readonly<Float64Array>;
    readonly entropyRate: Readonly<Float64Array>;
    readonly potency: Readonly<Float64Array>;
    readonly intensity: Readonly<Float64Array>;
    readonly decayRate: Readonly<Float64Array>;

    readonly checksum: Readonly<Float64Array>;

    readonly allocated: Readonly<Uint8Array>;
    readonly operatorClass: Readonly<Uint8Array>;
    readonly slotType: Readonly<Uint8Array>;

    readonly PartLayer: Readonly<Uint32Array>;
    readonly ComplexLayer: Readonly<Uint32Array>;
  }
}

declare namespace Mapping {
  /**
   * Configuration options for the geodesic routing process.
   */
  interface RouteOptions {
    /** The number of discrete steps to take along the path. */
    steps?: number;
    /** A set of scope IDs to prioritize during path attraction. */
    boostScopes?: Set<number>;
    /** The step size for gradient descent updates. */
    learningRate?: number;
    /** Maximum number of relaxation iterations. */
    maxIterations?: number;
    /** Whether to output detailed routing logs. */
    verbose?: boolean;
    /** The semantic topic to expand if a void is detected. */
    topic?: string;
    /** The index before new knowledge was ingested, used to mask past memory queries. */
    preExpandLength?: number;
    /**
     * E0 – Optional set of atom IDs to consider during force computation.
     * Candidates outside this set are skipped, restricting traversal to the
     * active framework region.  Interstitial atoms should always be included
     * by the caller.  Built from FrameworkIndex via resolveActiveAtoms().
     */
    activeAtoms?: Set<number>;
  }

  /**
   * Result of a path integrity review.
   */
  interface ReviewReport {
    /** Whether the path successfully avoided logic traps and remained stable. */
    passed: boolean;
    /** The reason for failure, if applicable. */
    reason?: string;
    /** The index in the path where a logic trap was detected. */
    trapIndex?: number;
  }

  interface Engine {
    setGPU(gpu: PMath.Engine | null): void;
    setUnfolder(unfolder: any): void;
    route(
      sourceId: number,
      targetId: number,
      options?: Mapping.RouteOptions
    ): Promise<Uint32Array>;
    /** Alias for route - same locomotion, clearer name. Optional for legacy implementations. */
    traverse?(
      sourceId: number,
      targetId: number,
      options?: Mapping.RouteOptions
    ): Promise<Uint32Array>;

    // Perception (was Resolution.Engine) - optional until Mapper absorbs Resolver everywhere
    perceive?(ids: Uint32Array, opts?: any): Promise<Uint32Array>;
    perceiveCapturing?(ids: Uint32Array, opts?: any): Promise<any>;
    perceiveCoherent?(ids: Uint32Array, opts?: any): Promise<any>;
    probe?(ids: Uint32Array): Promise<Uint32Array>;

    // Skills
    registerSkill?(preceptId: number, handler: any): void;
    electSkill?(ids: Uint32Array): number;
    process?(text: string): Promise<string>;

    // Learning
    learnCycle?(n?: number): Promise<Memory.ValidationReport | void>;

    // Motivation
    spawnIntent?(topic: string, energy?: number, tag?: any): number | null;
    startAutonomy?(): void;
    stopAutonomy?(): void;

    // Inquiry
    enqueueInquiry?(topic: string, query: string): void;
    drainInquiries?(n: number): Promise<Memory.InquiryItem[] | void>;
    onUnknown?: (topic: string) => void;
  }
}

/**
 * Resolution.Engine is collapsed into Mapping.Engine. A loose alias is kept
 * here for the duration of the transition so vendored "iso" test subjects
 * that pre-date the merge keep compiling. New code should target
 * Mapping.Engine directly.
 */
declare namespace Resolution {
  interface Engine {
    resolveSequence?(sequenceIds: Uint32Array): Promise<Uint32Array>;
    calculateGeodesic?(
      startId: number,
      endId: number,
      steps?: number,
      boostScopes?: Set<number>,
      topic?: string,
      preExpandLength?: number
    ): Promise<Uint32Array>;
  }
}
