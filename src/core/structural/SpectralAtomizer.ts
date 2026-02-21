import type System from "../integral/System";
import { OperatorClass } from "../integral/System";
import { ComplexArray } from "./FFT";

/**
 * The SpectralAtomizer is responsible for mapping raw physical signals
 * (RF spectrum, I/Q samples, Telemetry) into the logical manifold.
 *
 * It treats electromagnetic and spatial data as logical precursors,
 * where spectral peaks materialize as massive bodies and phase alignments
 * define logical operators through interference patterns.
 */
export default class SpectralAtomizer implements Atomic.Engine {
  /**
   * Initializes the spectral atomizer engine.
   */
  public async init(): Promise<void> {
    // Initialization if required
  }

  /**
   * Ingests a logical sequence (Compatibility method).
   * SpectralAtomizer primarily deals with raw signal data rather than text.
   */
  public ingestSequence(text: string, system: System): Uint32Array {
    throw new Error(
      "SpectralAtomizer requires raw signal or telemetry ingestion."
    );
  }

  /**
   * Decodes a manifold sequence (Compatibility method).
   */
  public decodeSequence(sequenceIds: Uint32Array, system: System): string {
    return "Spectral Data";
  }

  /**
   * Ingests raw I/Q samples, performs Fast Fourier Transform (FFT), and maps
   * identified spectral peaks to the logical manifold.
   *
   * @param iqSamples Raw complex signal samples.
   * @param sampleRate The sampling rate of the signal.
   * @param system The logical manifold to populate.
   * @returns A sequence of quantum IDs representing the spectral peaks.
   */
  public ingestRF(
    iqSamples: number[] | Float32Array | Float64Array,
    sampleRate: number,
    system: System
  ): Uint32Array {
    // 1. Convert to ComplexArray to handle real/imaginary components.
    const complex = new ComplexArray(iqSamples);

    // 2. Perform FFT to transition from time domain to frequency domain.
    const spectrum = complex.FFT();
    const magnitudes = spectrum.magnitude();

    // 3. Identify spectral peaks above a noise threshold.
    const threshold = 1.0;
    const peakIds: number[] = [];

    for (let i = 0; i < magnitudes.length / 2; i++) {
      if (magnitudes[i] > threshold) {
        const freq = i * (sampleRate / magnitudes.length);
        const amplitude = magnitudes[i];
        const phase = Math.atan2(spectrum.imag[i], spectrum.real[i]);

        // Logical Mapping:
        // Frequency (f) -> Scope: The structural reach is defined by the frequency.
        const scope = freq;

        // Amplitude (A) -> Mass: Signal strength translates to logical importance (gravitational pull).
        const mass = amplitude * system.c ** 2;

        // Phase -> Operator Class: Relative phase determines the type of logical interference.
        let opClass = OperatorClass.None;
        if (Math.abs(phase) < Math.PI / 4) {
          // Constructive interference is modeled as a Conjunction (AND).
          opClass = OperatorClass.Conjunction;
        } else if (Math.abs(phase) > (3 * Math.PI) / 4) {
          // Destructive interference is modeled as an Inversion (NOT).
          opClass = OperatorClass.Inversion;
        }

        // Materialize the spectral peak in the manifold.
        const id = system.createLocation(mass, scope);
        system.operatorClass[id] = opClass;

        // Initial entropy is low for clear, high-magnitude peaks.
        system.entropy[id] = 0.1;

        peakIds.push(id);
      }
    }

    return new Uint32Array(peakIds);
  }

  /**
   * Maps GPS and IMU telemetry to the 2D projected manifold.
   * Translates absolute physical coordinates and motion into topological state.
   *
   * @param gps Latitude and Longitude coordinates.
   * @param imu Inertial measurement data (pitch, roll, yaw).
   * @param isDrifting Whether the system is experiencing spatial instability.
   * @param system The logical manifold to populate.
   * @returns A sequence of quantum IDs representing the telemetry state.
   */
  public ingestTelemetry(
    gps: { lat: number; lon: number },
    imu: { pitch: number; roll: number; yaw: number },
    isDrifting: boolean,
    system: System
  ): Uint32Array {
    const ids: number[] = [];

    // Create a base Telemetry Truth Atom: a massive body representing current physical presence.
    const id = system.createLocation(system.c ** 2, 0);
    system.posX[id] = gps.lon;
    system.posY[id] = gps.lat;

    // Map IMU motion loosely to logical entropy to define spatial distortion/uncertainty.
    system.entropy[id] =
      Math.abs(imu.pitch) + Math.abs(imu.roll) + Math.abs(imu.yaw);
    ids.push(id);

    if (isDrifting) {
      // Inject a Destructive Interference Precept (Void).
      // A negative-mass entity that represents a "jammed" or invalid logical state.
      const voidId = system.createLocation(-(system.c ** 2), 0);
      system.posX[voidId] = gps.lon;
      system.posY[voidId] = gps.lat;
      system.entropy[voidId] = 100.0; // Extremely high entropy (uncertainty).
      system.operatorClass[voidId] = OperatorClass.Inversion;
      ids.push(voidId);
    }

    return new Uint32Array(ids);
  }
}
