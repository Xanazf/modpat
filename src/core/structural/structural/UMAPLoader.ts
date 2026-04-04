import * as fs from "node:fs";

/**
 * The UMAPLoader acts as the spatial architect for the Modulating Attenuation Topology.
 * It is responsible for loading and managing the 1D UMAP projections that define the
 * base coordinates (Scope) of semantic atoms within the manifold.
 *
 * By mapping words to specific spatial points, it allows the logic engine to calculate
 * distances and gravitational influences between operators and variables.
 */
export class UMAPLoader {
  /**
   * Internal mapping of semantic identifiers to their specific index within
   * the contiguous spatial manifold (umapBuffer).
   * @private
   */
  private wordIndices: Map<string, number> = new Map();

  /**
   * A contiguous memory block containing all pre-computed 1D UMAP spatial coordinates.
   * This represents the "fixed stars" of the semantic universe before operator
   * fields are applied.
   */
  public readonly umapBuffer: Float64Array;

  /**
   * Initializes the spatial manifold by loading dictionary mappings and binary coordinate data.
   *
   * @param binaryFilePath - Path to the raw binary file containing Float64 UMAP coordinates.
   * @param dictionaryFilePath - Path to the newline-separated dictionary file defining word order.
   */
  constructor(binaryFilePath: string, dictionaryFilePath: string) {
    if (!fs.existsSync(binaryFilePath) || !fs.existsSync(dictionaryFilePath)) {
      console.warn(
        `UMAP data not found at ${binaryFilePath} or ${dictionaryFilePath}. UMAP features will be disabled.`
      );
      this.umapBuffer = new Float64Array(0);
      return;
    }

    // 1. Load the pre-computed dictionary mapping
    // Format: newline-separated words exactly matching the binary array order
    const dictText = fs.readFileSync(dictionaryFilePath, "utf-8");
    const words = dictText.split("\n").filter(w => w.length > 0);

    for (let i = 0; i < words.length; i++) {
      this.wordIndices.set(words[i], i);
    }

    // 2. Load the raw binary UMAP float array directly into memory
    // Zero parsing overhead. The file bytes are directly cast to Float64.
    const fileBuffer = fs.readFileSync(binaryFilePath);

    // Ensure the buffer is aligned (Float64 requires 8-byte alignment)
    const alignedBuffer = new ArrayBuffer(fileBuffer.length);
    new Uint8Array(alignedBuffer).set(fileBuffer);

    this.umapBuffer = new Float64Array(alignedBuffer);
  }

  /**
   * Projects a word into the attenuation topology to retrieve its 1D spatial coordinate (Scope).
   *
   * If the word is found in the pre-computed manifold, its coordinate is scaled to
   * prevent spatial collisions. If not found (Out-of-Vocabulary), it is assigned
   * a distant coordinate far from the main semantic cluster.
   *
   * @param word - The semantic identifier to project.
   * @returns The 1D spatial coordinate (Scope) of the word.
   * @complexity $O(1)$ lookup.
   */
  public getScope(word: string): number {
    const lowerWord = word.toLowerCase();
    const index = this.wordIndices.get(lowerWord);

    if (index !== undefined && index < this.umapBuffer.length) {
      // Return the pre-calculated 1D UMAP projection
      // Scale it to prevent spatial collisions in the physics engine
      return this.umapBuffer[index] * 1000.0;
    }

    // Fallback for Out-of-Vocabulary words
    return this.hashStringToScope(lowerWord);
  }

  /**
   * Generates a deterministic fallback spatial coordinate for words not present
   * in the primary UMAP manifold.
   *
   * These coordinates are placed in the "outer rim" of the topology (starting at 50,000.0)
   * to ensure they do not interfere with well-defined semantic relationships.
   *
   * @param str - The Out-of-Vocabulary word.
   * @returns A distant spatial coordinate.
   * @private
   */
  private hashStringToScope(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 33) ^ str.charCodeAt(i);
    }
    // Isolate OOV words far from the main UMAP manifold
    return (Math.abs(hash) % 1000) * 0.001 + 50000.0;
  }
}
