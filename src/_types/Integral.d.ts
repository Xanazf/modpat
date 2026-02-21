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

  // Valid buffers for createView
  type ComplexF64Array = {
    real: Float64Array;
    imag: Float64Array;
  };

  type TargetUnion = "mass" | "time" | "density";
  interface System {
    // Main System object
    // - modeled after Direct Memory Access Buffer

    // Ring Buffer
    readonly patbuf: string[];

    // Number of contained Precept Proxies
    length: number;

    // Layer of isolated Parts (words)
    readonly PartLayer: Uint32Array;

    // Layer of Complex Parts (syllogisms|rules)
    readonly ComplexLayer: Uint32Array;

    // Clock speed or frame delta
    // speed of information;
    // ~16.67ms;
    readonly c: number;

    // Register a Part/Complex and get its Proxy
    createLocation(localMass: number, localScope: number): number;

    // Subscribe a proxy at index "i" to a proxy at index `j`
    createSignal(buffer: TargetUnion, j: number, v?: number): Signal;
  }
}

declare namespace Resolution {
  interface Engine {
    resolveSequence(sequenceIds: Uint32Array): Promise<Uint32Array>;
    calculateGeodesic(
      startId: number,
      endId: number,
      steps?: number,
      boostScopes?: Set<number>
    ): Promise<Uint32Array>;
  }
}
