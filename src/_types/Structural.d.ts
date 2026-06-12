declare namespace Atomic {
  interface Atom {
    id: string;
    template: (input: number[]) => boolean;
    resolve: (input: number[]) => number[];
  }

  interface Relation {
    subject: Atom;
    operator: "implies" | "equals" | "not";
    object: Atom;
  }

  interface Engine {
    ingestSequence(text: string, system: Root.ManifoldView): Uint32Array;
    ingestPattern(
      template: string,
      slotTypes: Map<number, number>,
      system: Root.ManifoldView
    ): Uint32Array;
    decodeSequence(sequenceIds: Uint32Array, system: Root.ManifoldView): string;
    getSymbolScope(symbol: string, isOperator: boolean): number;
    resolveScope(scope: number): string | undefined;
    init(): Promise<void>;
  }
}

declare namespace PMath {
  type Vector = number[];
  type Vector32 = Float32Array;
  type Vector64 = Float64Array;
  type Vector32_64 = Vector32 | Vector64;
  type Matrix = number[][];
  type Matrix32 = Vector32[];
  type Matrix64 = Vector64[];
  type Matrix32_64 = Vector32_64[];
  type Sequence = Matrix64;
  interface Engine {
    matMul(A: Matrix, B: Matrix): Promise<Matrix>;
    matMulF64(
      A: Vector32_64,
      B: Vector32_64,
      rowsA: number,
      colsB: number,
      innerDim: number
    ): Promise<Vector64>;

    add(A: Matrix, B: Matrix): Promise<Matrix>;
    addF64(A: Vector32_64, B: Vector32_64): Promise<Vector64>;
    mulScalarF64(A: Vector32_64, scalar: number): Promise<Vector64>;
    relu(A: Matrix): Promise<Matrix>;
    softmax(vector: Vector): Promise<Vector>;
    dispose?(): Promise<void>;
    reluV(A: Vector): Promise<Vector>;
  }
}

declare namespace Topology {
  /** One bar in a persistence diagram: birth, death, and the atom whose birth edge generated it. */
  interface PersistenceBar {
    birth: number;
    death: number;
    generatorAtomId: number;
  }

  interface PersistenceDiagram {
    h0: PersistenceBar[];
    h1: PersistenceBar[];
  }
}

/** Grounding - shapes for structural/grounding (GroundGraph, placement, fidelity). */
declare namespace Grounding {
  interface GroundNode {
    id: number;
    label: string;
    kind: import("@core_s/grounding/GroundGraph").NodeKind;
    /** Parsed value when the label is a numeric literal, else null. */
    numeric: number | null;
  }

  interface GroundEdge {
    from: number;
    to: number;
    kind: import("@core_s/grounding/GroundGraph").EdgeKind;
    /** Relative pull strength (astExtract energy, or 1.0 by default). */
    weight: number;
  }

  /**
   * A signed stance/antonym relation: the two nodes are mutually exclusive
   * ("modular" vs "monolithic", "cat" vs-not "fish"). NOT a fourth edge kind -
   * adjacency means attraction, and a contrast is the opposite claim: the placer
   * pushes the pair to opposite halves of the stance axis so their attractor
   * pulls genuinely oppose (a traveler between them stalls on a saddle instead
   * of being muted by crowding).
   */
  interface ContrastPair {
    a: number;
    b: number;
  }

  interface GroundGraph {
    nodes: GroundNode[];
    edges: GroundEdge[];
    /** Signed stance relations; empty/absent for graphs with no negation source. */
    contrasts?: ContrastPair[];
  }

  interface AdjacencyEntry {
    node: number;
    weight: number;
    kind: import("@core_s/grounding/GroundGraph").EdgeKind;
  }

  /** Result of mapFidelity(). */
  interface FidelityReport {
    /** Pearson r between graph hop-distance and manifold distance. */
    pearson: number;
    /** Mean manifold distance over graph edges (adjacent pairs). */
    adjacentMeanDist: number;
    /** Mean manifold distance over random non-adjacent pairs. */
    nonAdjacentMeanDist: number;
    /** nonAdjacentMeanDist / adjacentMeanDist; > 1 means structure is encoded. */
    separation: number;
    /** Number of (gdist, mdist) pairs the correlation was computed over. */
    samplePairs: number;
  }

  interface FidelityOptions {
    seed?: number;
    /** Cap on (gdist, mdist) pairs collected for the correlation. */
    maxPairs?: number;
    /** Random non-adjacent pairs sampled for the separation measure. */
    separationSamples?: number;
  }

  /** Result of traversalFidelity(). */
  interface TraversalFidelityReport {
    /** Number of (source, target) pairs evaluated. */
    pairs: number;
    /** Fraction of pairs whose emitted path contained the target node. */
    reachRate: number;
    /**
     * Mean over path-producing pairs of the fraction of consecutive recovered
     * graph-node hops that strictly reduced graph-distance-to-target. A faithful
     * geodesic approaches the target monotonically (-> 1.0); a random walk -> ~0.5.
     */
    monotonicity: number;
    /**
     * Fraction of interior recovered nodes that lie on *a* graph shortest path
     * from source to target (distFromSrc[v] + distToTgt[v] === graphDist).
     */
    onPathRate: number;
    /** Mean count of grounded graph-nodes recovered from the emitted paths. */
    meanGraphNodes: number;
    /** Fraction of pairs whose path recovered >= 2 grounded graph-nodes. */
    pathRate: number;
  }

  interface TraversalFidelityOptions {
    /** Cap on the number of pairs evaluated (each runs one traversal). */
    maxPairs?: number;
    /** Only sample pairs at least this many graph hops apart. */
    minGraphDist?: number;
  }

  /** A grounded 4D placement: parallel typed arrays, one entry per graph node. */
  interface Placement {
    x: Float64Array;
    y: Float64Array;
    z: Float64Array;
    w: Float64Array;
    mass: Float64Array;
  }

  interface GroundingOptions {
    /** Deterministic seed for the initial layout. */
    seed?: number;
    /** Stress-majorization iterations. */
    iterations?: number;
    /** posW scale for numeric literals (the number line uses 0.1). */
    numberLineScale?: number;
    /**
     * Z-offset applied per unit of stance: contrast-pair poles land
     * ±stanceScale apart on Z (adjacent terms sit ~1 apart in layout units, so
     * the default puts opposing camps well outside each other's wells).
     */
    stanceScale?: number;
  }

  interface IncrementalOptions extends GroundingOptions {
    /**
     * Nodes given the full global SMACOF treatment. Picked by centrality
     * (degree), so the heavy hubs - the operators - form the fixed skeleton the
     * rest of the graph hangs from.
     */
    anchorCount?: number;
    /** BFS depth when collecting placed constraints for one new node. */
    hopHorizon?: number;
    /** Local Guttman iterations per placed node. */
    localIterations?: number;
    /**
     * Full sweeps over the non-anchor nodes after accretion, re-relaxing each
     * against its (by then fully placed) neighbourhood. Still near-linear; lets
     * early-placed nodes benefit from constraints that did not exist yet when
     * they were placed.
     */
    polishPasses?: number;
  }

  interface AstGroundingOptions extends GroundingOptions {
    /**
     * Global SMACOF placement is O(nodes^2 x iterations). Above this node count
     * placement switches to the incremental, operator-anchored path
     * (`placeGraphIncremental`): full SMACOF for a centrality-selected anchor
     * skeleton, near-linear local accretion for everything else - whole-repo
     * scale without the global solve.
     */
    maxPlacementNodes?: number;
  }

  interface AstGroundingResult {
    graph: GroundGraph;
    /** graph node index -> System precept id (-1 if unallocated). */
    nodeToPrecept: Int32Array;
    /** node label -> System precept id, for crystallizing edge proofs. */
    labelToPrecept: Map<string, number>;
    /** Placement applied to the System, or null if the node cap was exceeded. */
    placement: Placement | null;
  }

  /** One arithmetic prediction-vs-evaluation case (Phase 4.5 survey loop). */
  interface ArithCase {
    /** Surface expression, e.g. "3 + 4". */
    expr: string;
    /** Operand precept ids - the ADDRESSES the error report points at. */
    aId: number;
    bId: number;
    /** Parsed operand values and operator (the territory's reading). */
    aVal: number;
    bVal: number;
    op: "+" | "-";
    /** Geometry's prediction: compose the operands' W positions. */
    predicted: number;
    /** Territory: evaluate the expression. */
    actual: number;
    match: boolean;
  }

  interface BehaviouralReport {
    total: number;
    matched: number;
    /** Fraction of geometric predictions that match actual evaluation. */
    fidelity: number;
    cases: ArithCase[];
    divergences: ArithCase[];
  }

  /** A precept implicated by divergences, with its terrain-suggested coordinate. */
  interface Suspect {
    /** The precept the divergences implicate. */
    id: number;
    /** Numeral the precept grounds (for reporting). */
    label: string;
    /** Where the corrupted survey put it. */
    currentW: number;
    /**
     * Where the territory says it belongs: the median of the W coordinate each
     * failing case independently implies for it (under a single-fault reading).
     */
    suggestedW: number;
    /** Failing cases this precept participates in. */
    failCount: number;
    /** Passing cases this precept participates in (counter-evidence). */
    passCount: number;
    /** Spread (max-min) of the implied W values; small = consistent story. */
    spread: number;
  }

  interface SurveyLoopResult {
    /** Fidelity before any repair. */
    before: BehaviouralReport;
    /** Fidelity after the loop finished. */
    after: BehaviouralReport;
    /** Each repair performed: which precept moved, from where, to where. */
    repairs: Suspect[];
    /** True if the loop ended with every prediction matching the territory. */
    converged: boolean;
  }
}

declare namespace Memory {
  type InquiryStatus =
    | "pending"
    | "tried_dict"
    | "tried_wiki"
    | "ask_user"
    | "resolved";

  interface InquiryItem {
    id: string;
    topic: string;
    originalQuery: string;
    status: InquiryStatus;
    addedAt: number;
    attempts: number;
  }

  enum KnowledgeState {
    Heard = 0,
    Remembered = 1,
    Learned = 2,
    Generalized = 3,
  }

  interface ChallengeCandidate {
    factText: string;
    signature: string;
    targetPattern: string;
    reproductionCount: number;
    knowledgeState: KnowledgeState;
    contextHash: string;
  }

  interface ChallengeResult {
    success: boolean;
    reproduced: string;
    expected: string;
    contextHash: string;
    coherence: number;
    /** Actions taken by the coherence loop during this challenge. */
    learned: string[];
    /**
     * True when the coherent result used a bridge candidate whose label is
     * NOT in the fact text - indicating the system reached the answer via a
     * stepping stone from a different domain (generalization signal).
     */
    hasGeneralizationSignal: boolean;
    /** The diagnostics from the coherent result. */
    diagnostics: any;
    /** The input probe ids. */
    probeIds: Uint32Array;
  }

  interface ValidationReport {
    challenged: number;
    promoted: number;
    failed: number;
    expandedTopics: string[];
    summary: {
      heard: number;
      remembered: number;
      learned: number;
      generalized: number;
    };
  }

  interface Vault {
    abstractSequence(sequenceIds: Uint32Array): {
      signature: string;
      varMap: Map<number, number>;
    };
    crystallizeProof(
      inputSequence: Uint32Array,
      outputSequence: Uint32Array,
      energy: number,
      slotFlags?: bigint
    ): Promise<void>;
    checkInterferencePattern(
      inputSequence: Uint32Array
    ): Promise<{ ids: Uint32Array; slotFlags: bigint; energy: number } | null>;

    signatureForText(text: string): string;
    storeFact(
      fact: string,
      source: string,
      confidence: number,
      signature: string
    ): Promise<void>;
    saveInquiryQueue(items: InquiryItem[]): Promise<void>;
    loadInquiryQueue(): Promise<InquiryItem[]>;
    findContradictingFacts(
      subject: string,
      predicate: string
    ): Promise<string[]>;

    sampleForChallenge(limit: number): Promise<ChallengeCandidate[]>;
    updateKnowledgeState(
      signature: string,
      state: KnowledgeState,
      repCount: number,
      ctxHash: string
    ): Promise<void>;
    getKnowledgeSummary(): Promise<{
      heard: number;
      remembered: number;
      learned: number;
      generalized: number;
    }>;

    /**
     * Provide the latest FrameworkIndex so factual vault matches can be
     * validated against the current domain topology.  Call after each
     * ManifoldLifecycle.consolidateAround() invocation.
     */
    setFrameworkIndex(index: any): void;

    flush(): Promise<void>;
    close?(): Promise<void>;
  }
}
