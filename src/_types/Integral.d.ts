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
    readonly version?: number;

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
    /**
     * IDs created through the structural grounding channel (code/logic/math
     * symbols), as opposed to language mentions. Cold-start co-occurrence
     * grounding restricts itself to these so it grounds toward genuine grounded
     * referents, not unrelated prior mentions that merely co-occurred.
     */
    groundedPrecepts: ReadonlySet<number>;

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
  /** Per-call inputs to perceive / perceiveCoherent / probe. */
  interface PerceptionOptions {
    /** Scopes from working memory; receive a warm-start energy bonus in Phase 2. */
    contextScopes?: Set<number>;
    /** Skip vault recall and NLP rules; used by learnCycle/challenge for physics-only verification. */
    probeMode?: boolean;
    /**
     * Run the Phase 2 emission gate (coherence + anti-echo). If the candidate
     * fails the gate, "unknown" is returned instead. Off by default so internal
     * probes / learn-cycles see raw results; the user-facing path enables it.
     */
    gated?: boolean;
  }

  /** Backward-compat alias for PerceptionOptions. */
  type ResolveOptions = PerceptionOptions;

  /**
   * Which mechanism produced a perceive result. Rule-bearing provenances
   * (vault / reduction / partlayer / formula / interference / geodesic) moved
   * along the reduction axis; "cluster" is the mass-ranked neighbourhood
   * fallback, which the emission gate holds to the anti-echo test at any output
   * length. "interference" is the wave channel's geometry-derived verdict (a
   * contradiction cancelled to a zero-amplitude band) - distinct from
   * "formula"'s symbolic rule miss that merely defers.
   */
  type Provenance =
    | "vault"
    | "reduction"
    | "partlayer"
    | "formula"
    | "interference"
    | "composition"
    | "synth"
    | "geodesic"
    | "cluster"
    | "void";

  /** Result returned by perceiveCoherent. */
  interface CoherentResult {
    ids: Uint32Array;
    /** [0, 1] – amplitude × contrast; ≥ COHERENCE_THRESHOLD is a found answer. */
    coherence: number;
    iterations: number;
    learned: string[];
    diagnosis: "coherent" | "void" | "conflict" | "weak" | "exhausted";
    diagnostics: Mapping.PerceptionDiagnostics | null;
  }

  /** A token at the intersection of the forward and backward resonance waves. */
  interface BridgeCandidate {
    idx: number;
    id: number;
    label: string;
    forwardEnergy: number;
    backwardEnergy: number;
    bridgeScore: number;
    isMissingLink: boolean;
  }

  /** A token found by resonance-peak analysis to exhibit operator-like wave topology. */
  interface DiscoveredOperator {
    id: number;
    idx: number;
    label: string;
    inferredClass: number; // OperatorClass value
    confidence: number;
    outboundRatio: number;
  }

  /** Full diagnostic snapshot from one perceive call. */
  interface PerceptionDiagnostics {
    N: number;
    tokenLabels: string[];
    operatorClasses: number[];
    W: Float64Array;
    accumulated: Float64Array;
    sinkCandidates: Array<{
      idx: number;
      id: number;
      label: string;
      strength: number;
      posX: number;
      posY: number;
      posZ: number;
      posW: number;
      opClass: number;
    }>;
    selectedTargetIdx: number;
    maxNetEnergy: number;
    discoveredOperators: Mapping.DiscoveredOperator[];
    bridgeCandidates: Mapping.BridgeCandidate[];
  }

  /** Race-free snapshot returned by perceiveCapturing. */
  interface PerceptionCapture {
    ids: Uint32Array;
    diagnostics: Mapping.PerceptionDiagnostics | null;
    sinkStrength: number;
    discoveredOperators: Mapping.DiscoveredOperator[];
    bridgeCandidates: Mapping.BridgeCandidate[];
  }

  /** D3 – result of a path homotopy check between two traversals. */
  interface HomotopyResult {
    homotopic: boolean;
    straddledH1Bars: Topology.PersistenceBar[];
    analogyScore: number;
  }

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
    setUnfolder(unfolder: import("@mutate/Unfolder").default | null): void;
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
    perceive?(ids: Uint32Array, opts?: PerceptionOptions): Promise<Uint32Array>;
    perceiveCapturing?(
      ids: Uint32Array,
      opts?: PerceptionOptions
    ): Promise<PerceptionCapture>;
    perceiveCoherent?(
      ids: Uint32Array,
      opts?: {
        probeMode?: boolean;
        maxIterations?: number;
        contextScopes?: Set<number>;
      }
    ): Promise<CoherentResult>;
    probe?(ids: Uint32Array): Promise<Uint32Array>;

    // Skills
    registerSkill?(
      preceptId: number,
      handler: (ctx: Skills.SkillContext) => Promise<Skills.SkillResult>
    ): void;
    electSkill?(ids: Uint32Array): number;
    process?(text: string): Promise<string>;

    // Learning
    learnCycle?(n?: number): Promise<Memory.ValidationReport | undefined>;

    // Motivation
    spawnIntent?(
      topic: string,
      energy?: number,
      tag?: import("@utils/intentPrecept").IntentTag
    ): number | null;
    startAutonomy?(): void;
    stopAutonomy?(): void;

    // Inquiry
    enqueueInquiry?(topic: string, query: string): void;
    drainInquiries?(n: number): Promise<Memory.InquiryItem[] | undefined>;
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

/**
 * Cognition - shapes shared across the skills/cognition pipeline (Perception,
 * Reduction, Coherence, Locomotion, InquiryQueue).
 */
declare namespace Cognition {
  /** A repulsive Gaussian well in the manifold used to steer locomotion. */
  interface PenaltyWell {
    x: number;
    y: number;
    z: number;
    w: number;
    strength: number;
  }

  /** Everything perception needs from the Traveler. */
  interface PerceptionDeps {
    readonly system: Root.ManifoldView;
    readonly atomizer: Atomic.Engine;
    store: import("@core_s/Memory").default | null;
    language: import("@skill_lang/Language").Language | null;
    lifecycle: import("@core_s/ManifoldLifecycle").ManifoldLifecycle | null;
    /** The locomotion grid index, already built by buildGridIndex(). */
    readonly gridIndex: import("@_lib/soa/GridIndex4D").GridIndex4D;
    buildGridIndex(): void;
    traverse(
      src: number,
      tgt: number,
      opts: Mapping.RouteOptions
    ): Promise<Uint32Array>;
    getMetricForce(
      px: number,
      py: number,
      pz: number,
      pw: number,
      pens: Cognition.PenaltyWell[],
      boost: Set<number> | undefined,
      activeAtoms?: Set<number>
    ): [V: number, fx: number, fy: number, fz: number, fw: number];
    boostAtomMasses(ids: Uint32Array): void;
    readonly position: [number, number, number, number];
    readonly activeFrameworks: Set<
      import("@mutate/FrameworkIndex").FrameworkId
    >;
    readonly lastInferentialEffort: number;
  }

  /** Mutable cache owned by the Traveler and passed into perception calls. */
  interface PerceptionCache {
    spatialIndex: import("@_lib/soa/GridIndex4D").GridIndex4D;
    lastIndexedLength: number;
    readonly synthesizer: import("@skill_code/Coder").Synthesizer;
  }

  /** Returned by the Observe → Follow → Read pipeline, post-gate. */
  interface PerceiveResult {
    ids: Uint32Array;
    sinkStrength: number;
    provenance: Mapping.Provenance;
    /**
     * Graded abstention tier (Phase 2). "definitive" - emitted through the gate
     * (or the gate was off). "hedged" - the gate abstained but a non-void
     * candidate exists; `candidate` carries it so the caller can surface it with
     * an explicit hedge instead of pure silence. "silent" - nothing to offer.
     */
    confidence: "definitive" | "hedged" | "silent";
    /** The gated-out candidate backing a "hedged" abstention. */
    candidate?: Uint32Array;
  }

  /** What the Observe → Follow → Read pipeline returns (pre-gate). */
  interface ObserveResult {
    ids: Uint32Array;
    sinkStrength: number;
    provenance: Mapping.Provenance;
  }

  interface ReductionResult {
    /** The reduct: a freshly materialized node distinct from the operands. */
    resultId: number;
    /** Numeric value of the reduct, read back from its W position. */
    value: number;
    /** posW of the reduct (its number-line coordinate). */
    reductW: number;
    /**
     * |reductW − posW(A)|: how far the conclusion moved along the reduction axis.
     * Strictly positive for a genuine reduction; zero would mean an echo.
     */
    reductionDistance: number;
  }

  interface IsRelation {
    /** Lemmatized subject. */
    subject: string;
    /** Lemmatized predicate / object. */
    object: string;
    /** True for universal rules ("all X are Y"); false for instances ("Z is X"). */
    universal: boolean;
    /** True for "is/are not" - never a positive IS edge; a negative edge instead. */
    negated: boolean;
    /**
     * True when this relation was produced by a rule firing (a discharged
     * implication or an eliminated disjunction), not stated as a premise.
     * Crossing a derived edge makes a conclusion a genuine derivation even at
     * hop 1 - the rule application IS the reduction step.
     */
    derived?: boolean;
  }

  interface EntailmentResult {
    /** Predicates reachable from the subject via IS edges (distinct from it). */
    conclusions: string[];
    /** Inference steps (hops) to each conclusion - the reduction distance. */
    hops: Map<string, number>;
    /**
     * Conclusions where a rule genuinely fired: hop >= 2, or the path crossed a
     * rule-derived edge (a discharged implication / eliminated disjunction).
     */
    derived: string[];
    /** Predicates negatively concluded ("not X") via a negated universal edge. */
    negative: string[];
    /** Hops to each negative conclusion (positive path + the negated edge). */
    negHops: Map<string, number>;
    /** Negative conclusions where a rule fired (hop >= 2 or a derived edge). */
    derivedNegative: string[];
  }

  /** A directed IS-graph edge used internally by reduceEntailment's BFS. */
  interface Edge {
    to: string;
    derived: boolean;
  }

  /**
   * A clause is the unit conditionals and alternations quantify over: either an
   * IS-fact ("the ground is wet") or an atomic proposition ("it rains", "p").
   */
  type Clause =
    | { kind: "is"; subject: string; object: string; negated: boolean }
    | { kind: "atom"; key: string; negated: boolean };

  interface Implication {
    antecedent: Clause;
    consequent: Clause;
    /** Set once the antecedent held and the consequent was asserted. */
    discharged?: boolean;
  }

  interface Disjunction {
    left: Clause;
    right: Clause;
    /** Set once one disjunct was refuted and the other asserted. */
    resolved?: boolean;
  }

  interface LogicFacts {
    relations: IsRelation[];
    implications: Implication[];
    disjunctions: Disjunction[];
    /** Atomic propositions asserted as standalone sentences ("it rains"). */
    atoms: Set<string>;
    /** Atomic propositions asserted negated ("it does not rain"). */
    negAtoms: Set<string>;
  }

  interface CoherenceOptions {
    /** s_effort = exp(-effortWeight · inferentialEffort). */
    effortWeight?: number;
    /** s_curvature = exp(-curvatureWeight · mean|R|). */
    curvatureWeight?: number;
    /** Singularity score above which the path is penalised (defaults to D1). */
    singularityThreshold?: number;
    /** score >= coherentThreshold => coherent. */
    coherentThreshold?: number;
  }

  interface CoherenceReport {
    /** Overall coherence in (0,1]; 1 = clean geodesic through faithful terrain. */
    score: number;
    /** score >= coherentThreshold. */
    coherent: boolean;
    /** Holonomy effort fed in (how much the path wound). */
    inferentialEffort: number;
    /** Mean |R| (scalar curvature) over path points. */
    meanCurvature: number;
    /** Max singularity score |∇φ|²/(1+φ²) over path points. */
    maxSingularity: number;
  }

  interface GateOptions extends CoherenceOptions {
    /** Output length above which echo detection activates. */
    longLength?: number;
    /** Echo fraction above which a long output is treated as a restatement. */
    echoLimit?: number;
    /**
     * Whether the candidate was produced by a rule-bearing mechanism (vault
     * recall, reduction, formula resolution, a real geodesic) rather than the
     * mass-ranked cluster fallback. Rule-derived short outputs are conclusions
     * and keep the short-output trust; a rule-free candidate is held to the
     * anti-echo test at ANY length - a one-token restatement of a premise is
     * still an echo, no matter how fluent. Defaults to true (the historical
     * behaviour) so callers without provenance are unchanged.
     */
    ruleDerived?: boolean;
  }

  interface GateVerdict {
    /** Whether the candidate output should be emitted. */
    emit: boolean;
    /** Short label for the decision (used in diagnostics). */
    reason: "coherent" | "void" | "abstain-passthrough" | "incoherent" | "echo";
    /** Underlying coherence report (terrain signal). */
    base: CoherenceReport;
    /** Fraction of allocated output tokens whose scope appears in the input. */
    echoFrac: number;
  }

  /** All mutable locomotion state owned by the Traveler. Create with makeLocomotionState(). */
  interface LocomotionState {
    gpu: PMath.Engine | null;
    geodesicPipeline: GPUComputePipeline | null;
    readonly gridIndex: import("@_lib/soa/GridIndex4D").GridIndex4D;
    readonly lastHolonomy: Float64Array; // 4×4 – updated each traverse
    lastInferentialEffort: number;
    readonly deltaGamma: Float64Array; // 64 floats – C4 Christoffel corrections
    phiClippedCount: number;
    _lastPathVelocity: [number, number, number, number];
    // -- getMetricForce scratch (reused across calls; no per-call allocation) --
    _candScratch: number[]; // candidate ids from the grid query
    _mfInfl: Float64Array; // per-surviving-candidate base influence
    _mfExp: Float64Array; // per-surviving-candidate exp(-d²/F) (the shared, costly term)
    _mfDx: Float64Array;
    _mfDy: Float64Array;
    _mfDz: Float64Array;
    _mfDw: Float64Array;
    // -- relaxPath per-point candidate cache (exact: keyed by integer cell coords) --
    _pcCands: number[][]; // one reused candidate-id list per path point
    _pcCellX: Int32Array; // last queried cell coords per point (cache key)
    _pcCellY: Int32Array;
    _pcCellZ: Int32Array;
    _pcCellW: Int32Array;
    // -- reusable traversal path buffers (grown per query, never per call) --
    _px: Float64Array;
    _py: Float64Array;
    _pe: Float64Array;
    _pa: Float64Array;
    readonly _relaxV: Float64Array; // length-4 scratch for relaxPath
    readonly _relaxCF: Float64Array;
  }
}

/**
 * Discourse - shapes for the text <-> manifold translation boundary.
 * Named "Discourse" (not "Language") to avoid colliding with the `Language`
 * class imported by name at most call sites.
 */
declare namespace Discourse {
  /** Result of Language.ingest(). */
  interface IngestResult {
    /** Manifold IDs for the ingested query sequence. */
    ids: Uint32Array;
    /** Structural classification of the input. */
    intent: import("@skill_lang/Language").ParsedIntent;
    /** For feedback intent: whether the feedback is positive or negative. */
    feedbackPolarity: import("@skill_lang/Language").FeedbackPolarity;
    /** The correction text, if the input is a negative feedback with correction. */
    correction: string | null;
    /** The text after perspective shifting. */
    shifted: string;
    /** Whether this is an identity query about the system itself. */
    isIdentityQuery: boolean;
    /** The topological query form for manifold lookup. */
    topologicalQuery: string;
    /** The attraction centre (main noun/subject). */
    attractionCenter: string;
    /** Whether the query involves arithmetic. */
    isArithmeticQuery: boolean;
    /** Whether the query involves ordinal succession. */
    isOrdinalQuery: boolean;
    /** Heat nodes for keyword matching. */
    heatNodes: string[];
    /** Vault signature for the topological query. */
    signature: string | null;
  }

  /** One turn of resolved conversational context (WorkingMemory). */
  interface MemoryFrame {
    query: string;
    conclusion: string; // decoded result text
    conclusionScope: number; // scope of the primary conclusion atom
    conclusionId: number; // manifold ID of the primary conclusion
    explanation: string | null; // terse inferential chain ("A → B → conclusion")
    turn: number;
  }
}

/** Code - shapes for the code-synthesis skill. */
declare namespace Code {
  /** A retrieved code pattern ready for composition. */
  interface CodePattern {
    /** Abstract pattern string, e.g. "function VAR_0(VAR_1) { VAR_BODY }" */
    template: string;
    /** Packed slot-type bitmap from wave_forms.slot_flags */
    slotFlags: bigint;
  }

  /** A parsed clause from a compound logical formula (E1Formula). */
  interface ParsedClause {
    antecedentScopes: Set<number>;
    antecedentIds: number[];
    consequentIds: number[];
    opId: number;
    universal: boolean;
    modifierId: number;
    isQuantifier: boolean;
    /** ID of the leading Inversion atom for negated facts ("not smoke"), or -1. */
    negationId: number;
  }
}

/** Skills - the open-ended skill registry for the Traveler. */
declare namespace Skills {
  interface SkillContext {
    /** The raw query text (already perspective-shifted by Language). */
    query: string;
    /** Manifold IDs for the ingested query sequence. */
    queryIds: Uint32Array;
    /** Reference to the live manifold the skill may inspect or extend. */
    system: Root.ManifoldView;
    /** Persistent vault for crystallising new proofs. */
    store: import("@core_s/Memory").default;
    /** Atomizer for encoding/decoding sequences. */
    atomizer: Atomic.Engine;
    /** The language boundary for translation and memory. */
    language: import("@skill_lang/Language").Language;
    /** Full result from Language.ingest() - includes isArithmeticQuery, attractionCenter, etc. */
    ingestResult?: Discourse.IngestResult;
  }

  interface SkillResult {
    /** Human-readable answer. */
    answer: string;
    /** Confidence in [0, 1]; used to weight vault crystallisation energy. */
    confidence: number;
  }

  interface SkillRegistration {
    /** Manifold ID of the capability precept this skill answers to. */
    preceptId: number;
    handler: import("@i_skills/index").SkillHandler;
  }
}

/** Geodesy - HoTT-kernel path/homotopy shapes (E3, topology/HoTTKernel). */
declare namespace Geodesy {
  interface PathEqualityResult {
    /** True when the loop path₁ + reversed(path₂) encloses no persistent H₁ generator. */
    homotopic: boolean;
    /** H₁ bars whose generators are enclosed by the loop (analogy candidates). */
    straddledH1Bars: Topology.PersistenceBar[];
    /** [0, 1] - fraction of qualified H₁ generators straddled. */
    analogyScore: number;
  }
}

declare namespace Mapping {
  /** Boot-time configuration for Runtime.boot(). */
  interface RuntimeOptions {
    /** Atomizer to use (default: "semantic"). Automatically falls back to "base" if embeddings are unavailable. */
    atomizer?: import("@core_i/Runtime").AtomizerMode;
    /** DuckDB path (default: ":memory:"). */
    db?: string;
    /** Skip SelfConcept initialisation - useful in test environments that don't need identity axioms. */
    skipIdentity?: boolean;
    /** Called if the requested atomizer fails to load and the runtime falls back to "base". */
    onFallback?: (reason: string) => void;
    /**
     * Disable the automatic maintenance tick (decay + age refresh).
     * Useful in tests that want a fully static manifold.
     * Default: tick is started automatically.
     */
    noTick?: boolean;
    /**
     * Disable full ManifoldLifecycle wrapping (TMR allocator, primary/emergency
     * failover, gravitational consolidation, and dream cycle).
     * Default: lifecycle is active. Set this in unit/stress/perf tests that need
     * a plain System with lightweight decay only.
     */
    noLifecycle?: boolean;
    /**
     * Disable worker threads.  Useful in test environments that don't need
     * off-thread computation and want to avoid the worker startup overhead.
     */
    noWorkers?: boolean;
    /**
     * Root paths to scan for TypeScript/JavaScript source files.
     * When set, an AstSeedWorker is created and started automatically if the
     * manifold is fresh (system.length < 100 precepts at boot).
     */
    astSeedPaths?: string[];
    /** Options forwarded to AstSeedWorker.start(). */
    astSeedOptions?: WorkerIPC.AstSeedOptions;
    /**
     * Interval in ms for the autonomous learner cycle (default: 10 000).
     * Handled by Traveler.startAutonomy() internally.
     */
    learnerIntervalMs?: number;
    /**
     * Enable the background constellation gap scanner (default: true when lifecycle is active).
     * Set to false to disable proactive curiosity enqueueing.
     */
    proactivity?: boolean;
    /** Gap scan interval in ms (default: 30 000). */
    gapScanIntervalMs?: number;
  }
}
