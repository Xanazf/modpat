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
    ingestSequence(text: string, system: System): Uint32Array;
    decodeSequence(sequenceIds: Uint32Array, system: System): string;
    getSymbolScope(symbol: string, isOperator: boolean): number;
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
  interface Vault {
    abstractSequence(sequenceIds: Uint32Array): {
      signature: string;
      varMap: Map<number, number>;
    };
    crystallizeProof(
      inputSequence: Uint32Array,
      outputSequence: Uint32Array,
      energy: number
    ): Promise<void>;
    checkInterferencePattern(
      inputSequence: Uint32Array
    ): Promise<Uint32Array | null>;

    flush(): Promise<void>;
    close?(): Promise<void>;
  }
}
