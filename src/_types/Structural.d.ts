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
