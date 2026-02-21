import type { ComplexObject, HandleArray } from "./ComplexArray";
import baseComplexArray from "./ComplexArray";

/**
 * FFT_LOGIC provides a set of logical operators that operate on wave-based
 * logic signals rather than simple boolean values.
 *
 * In this paradigm:
 * - Logical truths are represented as signal amplification (interference).
 * - Uncertainty or "OR" operations are represented as signal dampening or mixing.
 * - Negation is represented as a phase shift (polarity inversion).
 */
export const FFT_LOGIC = {
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

// Math constants and functions we need.
const PI: number = Math.PI;
const SQRT1_2: number = Math.SQRT1_2;

/** Function signature for filtering frequency-space signals. */
type filterable = (value: ComplexObject, i: number, n: number) => void;

/**
 * Transforms a logical signal from the real-space manifold to frequency-space.
 *
 * This allows for spectral analysis of logical patterns, identifying
 * dominant frequencies of thought.
 *
 * @param input - The real-space logic signal.
 * @returns The frequency-space representation.
 */
export function FFT(input: HandleArray): ComplexArray {
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
export function InvFFT(input: HandleArray): ComplexArray {
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
export function frequencyMap(
  input: HandleArray,
  filterer: filterable
): ComplexArray {
  return ensureComplexArray(input).frequencyMap(filterer);
}

/**
 * ComplexArray extends the base complex storage with Fast Fourier
 * Transform capabilities tailored for logical signals.
 */
export class ComplexArray extends baseComplexArray {
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
  frequencyMap(filterer: filterable): ComplexArray {
    return this.FFT().map(filterer).InvFFT();
  }
}

/**
 * Internal helper to ensure input is a ComplexArray.
 * @private
 */
function ensureComplexArray(input: HandleArray): ComplexArray {
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
