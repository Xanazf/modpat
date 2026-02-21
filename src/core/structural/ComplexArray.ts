/**
 * Represents a single quantum of a logical signal.
 * It contains both real (amplitude/magnitude) and imaginary (phase) components,
 * allowing for complex wave-based logical interference.
 */
export type ComplexObject = {
  real: number;
  imag: number;
};

/**
 * Supported underlying array types for logical signal storage.
 */
export type HandleArray =
  | Float32Array
  | Float64Array
  | Uint8ClampedArray
  | number[];

export type ArrayConstructor = {
  new (size: number): HandleArray;
  new (data: HandleArray): HandleArray;
};

/**
 * ComplexArray is the fundamental storage structure for wave-based logic patterns.
 *
 * It stores a series of logical signal quanta in separate real and imaginary
 * arrays to optimize for vectorized operations and signal processing transforms
 * like the FFT.
 */
export default class ComplexArray {
  /** The constructor of the underlying array type. */
  ArrayType: ArrayConstructor;
  /** Contiguous storage for the real components of the logical signals. */
  real: HandleArray;
  /** Contiguous storage for the imaginary components of the logical signals. */
  imag: HandleArray;
  /** The total number of signal quanta in the array. */
  length: number = 0;

  /**
   * Initializes a new complex logical signal array.
   *
   * @param other - Source data: another ComplexArray, a fixed size, or an array-like object.
   * @param arrayType - The typed array constructor to use for storage (defaults to Float32Array).
   */
  constructor(
    other: HandleArray | number | ComplexArray,
    arrayType: ArrayConstructor = Float32Array as unknown as ArrayConstructor
  ) {
    if (other instanceof ComplexArray) {
      // Copy constructor: preserves the existing logical pattern.
      this.ArrayType = other.ArrayType;
      this.real = new this.ArrayType(other.real);
      this.imag = new this.ArrayType(other.imag);
    } else if (typeof other === "number") {
      // Size-based allocation: creates an empty logic buffer.
      this.ArrayType = arrayType;
      this.real = new this.ArrayType(other);
      this.imag = new this.ArrayType(other);
      if ((this.ArrayType as unknown) === Array) {
        (this.real as number[]).fill(0);
        (this.imag as number[]).fill(0);
      }
    } else {
      // Array-like input: initializes the real component with the provided values.
      this.ArrayType = arrayType;
      this.real = new this.ArrayType(other);
      this.imag = new this.ArrayType(this.real.length);
      if ((this.ArrayType as unknown) === Array) {
        (this.imag as number[]).fill(0);
      }
    }

    this.length = this.real.length;
  }

  /**
   * Calculates the complex conjugate of the signal pattern.
   *
   * Physics: Inverts the phase component of the signal. Often used
   * in signal correlation or specialized logical transformations.
   *
   * @returns A new ComplexArray containing the conjugated pattern.
   */
  conjugate(): ComplexArray {
    const result = new ComplexArray(this);
    for (let i = 0; i < this.length; i++) {
      (result.imag as number[])[i] *= -1;
    }
    return result;
  }

  /**
   * Generates a string representation of the logical wave pattern.
   */
  toString(): string {
    const components: string[] = [];
    for (let i = 0; i < this.length; i++) {
      components.push(
        `(${this.real[i].toFixed(2)}, ${this.imag[i].toFixed(2)})`
      );
    }
    return `[${components.join(", ")}]`;
  }

  /**
   * Iterates over each quantum in the logical signal.
   *
   * @param iterator - Callback function for each complex signal point.
   */
  forEach(
    iterator: (value: ComplexObject, i: number, n: number) => void
  ): void {
    const n = this.length;
    // For gc efficiency, reuse a single object to minimize pressure.
    const value: ComplexObject = { real: 0, imag: 0 };

    for (let i = 0; i < n; i++) {
      value.real = this.real[i];
      value.imag = this.imag[i];
      iterator(value, i, n);
    }
  }

  /**
   * Performs an in-place transformation of the logical signal pattern.
   *
   * @param mapper - Callback function that modifies the real/imag components.
   * @returns The current instance (useful for chaining).
   */
  map(mapper: (value: ComplexObject, i: number, n: number) => void): this {
    const n = this.length;
    const value: ComplexObject = { real: 0, imag: 0 };
    for (let i = 0; i < n; i++) {
      value.real = (this.real as number[])[i];
      value.imag = (this.imag as number[])[i];
      mapper(value, i, n);
      (this.real as number[])[i] = value.real;
      (this.imag as number[])[i] = value.imag;
    }
    return this;
  }

  /**
   * Calculates the "logical intensity" (absolute magnitude) of the
   * signal at each point.
   *
   * This represents the strength of the logical signal independent
   * of its phase/polarity.
   *
   * @returns An array of magnitudes in the original ArrayType.
   */
  magnitude(): HandleArray {
    const mags = new this.ArrayType(this.length);
    for (let i = 0; i < this.length; i++) {
      const r = (this.real as number[])[i];
      const j = (this.imag as number[])[i];
      (mags as number[])[i] = Math.sqrt(r * r + j * j);
    }
    return mags;
  }
}
