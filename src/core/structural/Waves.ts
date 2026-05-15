/**
 * Waves.ts — Unified wave mathematics for ModPAT's spectral logic layer.
 *
 * Consolidates complex-number storage (ComplexArray) and Fast Fourier Transform
 * (FFT) implementations into a single module. All wave-based logic operators,
 * frequency-space transforms, and complex signal primitives live here.
 *
 * @module Waves
 */

/**
 * BaseComplexArray is the fundamental storage structure for wave-based logic
 * patterns.
 *
 * It stores a series of logical signal quanta in separate real and imaginary
 * arrays to optimize for vectorized operations and signal processing transforms
 * like the FFT.
 */
class BaseComplexArray {
  /** The constructor of the underlying array type. */
  ArrayType: ArrayConstructor;
  /** Contiguous storage for the real components of the logical signals. */
  real: Wave.HandleArray;
  /** Contiguous storage for the imaginary components of the logical signals. */
  imag: Wave.HandleArray;
  /** The total number of signal quanta in the array. */
  length: number = 0;

  /**
   * Initializes a new complex logical signal array.
   *
   * @param other - Source data: another BaseComplexArray, a fixed size, or an array-like object.
   * @param arrayType - The typed array constructor to use for storage (defaults to Float32Array).
   */
  constructor(
    other: Wave.HandleArray | number | BaseComplexArray,
    arrayType: ArrayConstructor = Float32Array as unknown as ArrayConstructor
  ) {
    if (other instanceof BaseComplexArray) {
      // Copy constructor: preserves the existing logical pattern.
      this.ArrayType = other.ArrayType;
      this.real = new this.ArrayType(other.real) as unknown as Wave.HandleArray;
      this.imag = new this.ArrayType(other.imag) as unknown as Wave.HandleArray;
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
      this.real = new this.ArrayType(other) as unknown as Wave.HandleArray;
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
   * @returns A new BaseComplexArray containing the conjugated pattern.
   */
  conjugate(): BaseComplexArray {
    const result = new BaseComplexArray(this);
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
    iterator: (value: Wave.ComplexObject, i: number, n: number) => void
  ): void {
    const n = this.length;
    // For gc efficiency, reuse a single object to minimize pressure.
    const value: Wave.ComplexObject = { real: 0, imag: 0 };

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
  map(mapper: (value: Wave.ComplexObject, i: number, n: number) => void): this {
    const n = this.length;
    const value: Wave.ComplexObject = { real: 0, imag: 0 };
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
  magnitude(): Wave.HandleArray {
    const mags = new this.ArrayType(this.length);
    for (let i = 0; i < this.length; i++) {
      const r = (this.real as number[])[i];
      const j = (this.imag as number[])[i];
      (mags as number[])[i] = Math.sqrt(r * r + j * j);
    }
    return mags;
  }
}

/**
 * ComplexArray extends the base complex storage with Fast Fourier
 * Transform capabilities tailored for logical signals.
 *
 * This is the primary public class — consumers should use this rather than
 * BaseComplexArray directly.
 */
class ComplexArray extends BaseComplexArray {
  /**
   * Performs the Forward Fast Fourier Transform.
   */
  FFT(): ComplexArray {
    return fft(this, false);
  }

  /**
   * Performs the Inverse Fast Fourier Transform.
   */
  InvFFT(): ComplexArray {
    return fft(this, true);
  }

  /**
   * Chains FFT, a custom filterer, and InvFFT to process a signal.
   *
   * @param filterer - Function to apply in frequency space.
   */
  frequencyMap(filterer: Wave.Filterable): ComplexArray {
    return this.FFT().map(filterer).InvFFT();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Wave Logic Operators
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * FFT_LOGIC provides a set of logical operators that operate on wave-based
 * logic signals rather than simple boolean values.
 *
 * In this paradigm:
 * - Logical resonances are represented as signal amplification (interference).
 * - Uncertainty or "OR" operations are represented as signal dampening or mixing.
 * - Negation is represented as a phase shift (polarity inversion).
 */
const FFT_LOGIC = {
  // NOTE: Abstract
  // The result of these transforms is not boolean logic
  // but the result of wave interference, i.e:
  //  - results operate in wave logic;
  //  - truthy results (AND) = signal amplification;
  //    - constructive = increase scope:
  //      - AND(TRUE, NOT(TRUE)) = TRUE;
  //    - destructive = pattern mismatch:
  //      - AND(TRUE, NOT(TRUE)) = FALSE;
  //  - 50/50 results (OR) = signal dampening;
  //    - uncertain decrease scope;

  /**
   * Performs a wave-based AND operation using constructive interference.
   *
   * Logic: Both signals must be in phase to amplify. This amplification
   * is necessary to highlight a resonant logical signal within the noise.
   * Physics: Vector addition of complex amplitudes.
   *
   * @param a - The first complex logic signal.
   * @param b - The second complex logic signal.
   * @param out - Pre-allocated destination for the result.
   * @returns The amplified (or interfered) signal.
   */
  and: (
    a: Root.ComplexF64Array,
    b: Root.ComplexF64Array,
    out: Root.ComplexF64Array // prealloc destination to avoid GC
  ): Root.ComplexF64Array => {
    for (let i = 0; i < a.real.length; i++) {
      // Constructive: A + B
      out.real[i] = a.real[i] + b.real[i];
      out.imag[i] = a.imag[i] + b.imag[i];
    }
    return out;
  },

  /**
   * Performs a wave-based OR operation using normalized summation (mixing).
   *
   * Logic: The presence of either signal maintains the level, but the
   * uncertainty of "either" results in a dampened combined signal.
   * Physics: (A + B) / 2 to prevent amplitude runaway (clipping).
   *
   * @param a - The first complex logic signal.
   * @param b - The second complex logic signal.
   * @param out - Pre-allocated destination for the result.
   * @returns The combined (mixed) signal.
   */
  or: (
    a: Root.ComplexF64Array,
    b: Root.ComplexF64Array,
    out: Root.ComplexF64Array // prealloc destination to avoid GC
  ): Root.ComplexF64Array => {
    for (let i = 0; i < a.real.length; i++) {
      out.real[i] = (a.real[i] + b.real[i]) / 2;
      out.imag[i] = (a.imag[i] + b.imag[i]) / 2;
    }
    return out;
  },

  /**
   * Performs a wave-based NOT operation using polarity inversion (phase shift).
   *
   * Logic: Flip the logical polarity of the signal.
   * Physics: Rotate the phase by 180 degrees (multiply by -1).
   *
   * @param a - The complex logic signal to invert.
   * @param out - Pre-allocated destination for the result.
   * @returns The phase-shifted (inverted) signal.
   */
  not: (
    a: Root.ComplexF64Array,
    out: Root.ComplexF64Array // prealloc destination to avoid GC
  ): Root.ComplexF64Array => {
    for (let i = 0; i < a.real.length; i++) {
      out.real[i] = -a.real[i];
      out.imag[i] = -a.imag[i];
    }
    return out;
  },
};

/**
 * Transforms a logical signal from the real-space manifold to frequency-space.
 *
 * This allows for spectral analysis of logical patterns, identifying
 * dominant frequencies of thought.
 *
 * @param input - The real-space logic signal.
 * @returns The frequency-space representation.
 */
function FFT(input: Wave.HandleArray): ComplexArray {
  return ensureComplexArray(input).FFT();
}

/**
 * Transforms a frequency-space signal back into the real-space manifold.
 *
 * Used after filtering or processing logical signals in frequency-space
 * to restore them to the spatial topology.
 *
 * @param input - The frequency-space logic signal.
 * @returns The restored real-space signal.
 */
function InvFFT(input: Wave.HandleArray): ComplexArray {
  return ensureComplexArray(input).InvFFT();
}

/**
 * Applies a filter to a logic signal in frequency-space and returns
 * the result in real-space.
 *
 * This is the standard method for "tuning" logical signals or
 * attenuating specific frequency components of a deduction.
 *
 * @param input - The real-space logic signal to filter.
 * @param filterer - The function that modifies frequency components.
 * @returns The filtered real-space signal.
 */
function frequencyMap(
  input: Wave.HandleArray,
  filterer: Wave.Filterable
): ComplexArray {
  return ensureComplexArray(input).frequencyMap(filterer);
}

// Math constants.
const PI: number = Math.PI;
const SQRT1_2: number = Math.SQRT1_2;

/**
 * Internal helper to ensure input is a ComplexArray.
 * @private
 */
function ensureComplexArray(input: Wave.HandleArray): ComplexArray {
  return (input instanceof ComplexArray && input) || new ComplexArray(input);
}

/**
 * Core FFT dispatcher that selects the most efficient algorithm
 * based on the signal length.
 * @private
 */
function fft(input: ComplexArray, inverse: boolean): ComplexArray {
  const n: number = input.length;

  if (n <= 1) return input;

  // Use radix-2 iterative approach for power-of-two lengths,
  // otherwise fallback to recursive mixed-radix.
  return n & (n - 1)
    ? FFT_Recursive(input, inverse)
    : FFT_2_Iterative(input, inverse);
}

/**
 * Mixed-radix recursive FFT implementation.
 * @private
 */
function FFT_Recursive(input: ComplexArray, inverse: boolean): ComplexArray {
  const n: number = input.length;

  if (n <= 1) return input;

  const output: ComplexArray = new ComplexArray(n, input.ArrayType);

  // Use the lowest odd factor, so we are able to use FFT_2_Iterative in the
  // recursive transforms optimally.
  const p: number = LowestOddFactor(n);
  const m: number = n / p;
  const normalisation: number = 1 / Math.sqrt(p);
  let recursive_result = new ComplexArray(m, input.ArrayType);

  for (let j = 0; j < p; j++) {
    for (let i = 0; i < m; i++) {
      recursive_result.real[i] = input.real[i * p + j];
      recursive_result.imag[i] = input.imag[i * p + j];
    }
    // Don't go deeper unless necessary to save allocs.
    if (m > 1) {
      recursive_result = fft(recursive_result, inverse);
    }

    const del_f_r: number = Math.cos((2 * PI * j) / n);
    const del_f_i: number = (inverse ? -1 : 1) * Math.sin((2 * PI * j) / n);
    let f_r: number = 1;
    let f_i: number = 0;

    for (let i = 0; i < n; i++) {
      const _real: number = recursive_result.real[i % m];
      const _imag: number = recursive_result.imag[i % m];

      output.real[i] += f_r * _real - f_i * _imag;
      output.imag[i] += f_r * _imag + f_i * _real;

      const next_f_r = f_r * del_f_r - f_i * del_f_i;
      const next_f_i = f_r * del_f_i + f_i * del_f_r;
      f_r = next_f_r;
      f_i = next_f_i;
    }
  }

  // Copy back to input to match FFT_2_Iterative in-placeness
  for (let i = 0; i < n; i++) {
    input.real[i] = normalisation * output.real[i];
    input.imag[i] = normalisation * output.imag[i];
  }

  return input;
}

/**
 * Iterative Radix-2 FFT implementation for high-efficiency signal processing.
 * @private
 */
function FFT_2_Iterative(input: ComplexArray, inverse: boolean): ComplexArray {
  const n: number = input.length;

  const output: ComplexArray = BitReverseComplexArray(input);
  const [output_r, output_i] = [output.real, output.imag];

  let width: number = 1;
  while (width < n) {
    const del_f_r: number = Math.cos(PI / width);
    const del_f_i: number = (inverse ? -1 : 1) * Math.sin(PI / width);
    for (let i = 0; i < n / (2 * width); ++i) {
      let f_r: number = 1;
      let f_i: number = 0;
      for (let j = 0; j < width; j++) {
        const l_index = 2 * i * width + j;
        const r_index = l_index + width;

        const left_r = output_r[l_index];
        const left_i = output_i[l_index];
        const right_r = f_r * output_r[r_index] - f_i * output_i[r_index];
        const right_i = f_i * output_r[r_index] + f_r * output_i[r_index];

        output_r[l_index] = SQRT1_2 * (left_r + right_r);
        output_i[l_index] = SQRT1_2 * (left_i + right_i);
        output_r[r_index] = SQRT1_2 * (left_r - right_r);
        output_i[r_index] = SQRT1_2 * (left_i - right_i);

        const next_f_r = f_r * del_f_r - f_i * del_f_i;
        const next_f_i = f_r * del_f_i + f_i * del_f_r;
        f_r = next_f_r;
        f_i = next_f_i;
      }
    }
    width <<= 1;
  }

  return output;
}

/**
 * Calculates the bit-reversed index for FFT shuffling.
 * @private
 */
function BitReverseIndex(index: number, n: number): number {
  let bitreversed_index = 0;

  while (n > 1) {
    bitreversed_index <<= 1;
    bitreversed_index += index & 1;
    index >>= 1;
    n >>= 1;
  }
  return bitreversed_index;
}

/**
 * Reorders a ComplexArray using bit-reversal permutation.
 * @private
 */
function BitReverseComplexArray(array: ComplexArray): ComplexArray {
  const n: number = array.length;

  for (let i = 0; i < n; i++) {
    const r_i: number = BitReverseIndex(i, n);

    if (i < r_i) {
      [array.real[i], array.real[r_i]] = [array.real[r_i], array.real[i]];
      [array.imag[i], array.imag[r_i]] = [array.imag[r_i], array.imag[i]];
    }
  }

  return array;
}

/**
 * Finds the lowest odd factor of an integer.
 * @private
 */
function LowestOddFactor(n: number): number {
  const sqrt_n: number = Math.sqrt(n);
  let factor: number = 3;

  while (factor <= sqrt_n) {
    if (n % factor === 0) return factor;
    factor += 2;
  }
  return n;
}

export { ComplexArray, FFT_LOGIC, FFT, InvFFT, frequencyMap };
