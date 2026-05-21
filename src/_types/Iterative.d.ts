/**
 * Typed deltas posted by async producers (dreamCycle, Unfolder, GPU readbacks)
 * and drained synchronously by ManifoldLifecycle.tick().
 */
declare namespace Delta {
  interface Ingest {
    kind: "ingest";
    text: string;
    basePosX: number;
    basePosY: number;
    factDisplacementZ: number;
  }

  interface Update {
    kind: "update";
    id: number;
    field:
      | "mass"
      | "posX"
      | "posY"
      | "posZ"
      | "posW"
      | "decayRate"
      | "depth"
      | "time";
    value: number;
  }

  interface Free {
    kind: "free";
    id: number;
  }

  type Any = Ingest | Update | Free;
}

/**
 * Topological lifecycle events emitted by ManifoldLifecycle during its
 * low-frequency topology tick.  Consumers: dream-cycle prioritisation,
 * vault tagging, InquiryQueue curiosity seeding.
 */
declare namespace Topology {
  type Event =
    | { type: "component_birth"; persistence: number; atomId: number }
    | { type: "component_death"; persistence: number; atomId: number }
    | { type: "loop_appeared"; persistence: number; atomId: number }
    | { type: "loop_collapsed"; persistence: number; atomId: number };
}

declare namespace Wave {
  /**
   * Represents a single quantum of a logical signal.
   * It contains both real (amplitude/magnitude) and imaginary (phase) components,
   * allowing for complex wave-based logical interference.
   */
  type ComplexObject = {
    real: number;
    imag: number;
  };

  /**
   * Supported underlying array types for logical signal storage.
   */
  type HandleArray = Float32Array | Float64Array | Uint8ClampedArray | number[];

  type ArrayConstructor = {
    new (size: number): HandleArray;
    new (data: HandleArray): HandleArray;
  };

  /** Function signature for filtering frequency-space signals. */
  type Filterable = (value: ComplexObject, i: number, n: number) => void;
}
