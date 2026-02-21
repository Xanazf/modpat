export class SpatialMapper {
  /**
   * Projects the 64-bit physics buffers into an interleaved 32-bit graphics/compute buffer.
   * Output format: [x, y, z, w, x, y, z, w, ...]
   */
  public static projectToVec4(system: System): Float32Array {
    const length = system.length;
    const vertexBuffer = new Float32Array(length * 4);

    for (let i = 0; i < length; i++) {
      const idx = i * 4;

      // X: Mass
      vertexBuffer[idx] = system.mass[i];

      // Y: Scope
      vertexBuffer[idx + 1] = system.scope[i];

      // Z: Time (Assertion Energy)
      // Dampened visually by the Entropy state
      vertexBuffer[idx + 2] = system.time[i] * system.entropy[i];

      // W: Entropy
      vertexBuffer[idx + 3] = system.entropy[i];
    }

    return vertexBuffer;
  }

  /**
   * Calculates the 4D Euclidean distance between two precepts to determine
   * their contextual relevance to one another.
   */
  public static calculate4DDistance(
    system: System,
    idA: number,
    idB: number
  ): number {
    const dx = system.mass[idB] - system.mass[idA];
    const dy = system.scope[idB] - system.scope[idA];
    const dz = system.time[idB] - system.time[idA];
    const dw = system.entropy[idB] - system.entropy[idA];

    return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
  }
}
