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

declare namespace Memory {
  const enum KnowledgeState {
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
    ): Promise<{ ids: Uint32Array; slotFlags: bigint } | null>;

    signatureForText(text: string): string;
    rawFactExists(fact: string): Promise<boolean>;

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

    flush(): Promise<void>;
    close?(): Promise<void>;
  }
}
