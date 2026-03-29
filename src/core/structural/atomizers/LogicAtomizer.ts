import type System from "@core_i/System";
import { classifyOperatorToken } from "@core_i/System";
import { BaseAtomizer } from "./BaseAtomizer";

/**
 * The Atomizer is a low-level logical parser responsible for converting
 * symbolic strings into physical "Massive Bodies" within the logical manifold.
 *
 * It materializes abstract language into a concrete state-space where
 * operators act as gravitational attractors and variables act as particles.
 */
export default class Atomizer extends BaseAtomizer implements Atomic.Engine {
  /** Regular expression to identify logical operators within a string. */
  private logicRegex =
    /\b(if|then|else|exists|implies|for\s+all|not|all|are|is)\b|=>|\|-|&&|\|\|/i;
  /** Identifies operators that signify a right-directional logical conclusion. */
  private rightDirectionalRegex = /\|-|\btherefore\b/i;

  /**
   * Initializes the atomizer engine.
   */
  public async init(): Promise<void> {}

  /**
   * Calculates the structural Scope (frequency) for a symbol by automatically
   * detecting if it represents a logical operator.
   *
   * @param symbol The string token.
   * @returns The calculated physical scope.
   */
  public getSymbolScope(symbol: string): number {
    const isOperator = this.logicRegex.test(symbol);
    return super.getSymbolScope(symbol, isOperator);
  }

  /**
   * Ingests a logical sequence, mapping each token to a coordinate in the
   * Space-Time manifold of the logic system.
   *
   * @param text The raw logical statement or sequence.
   * @param system The logical manifold to populate.
   * @returns A sequence of quantum IDs representing the materialized tokens.
   */
  public ingestSequence(text: string, system: System): Uint32Array {
    // Split the text into tokens while preserving logical operators and punctuation.
    const tokens = text
      .split(/(for\s+all|=>|\|-|&&|\|\||\s+|\b|\(|\))/i)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const sequenceIds = new Uint32Array(tokens.length);

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const isOperator = this.logicRegex.test(token);

      // 1. Calculate Logical Mass (m = E/c^2).
      // Operators are massive attractors that define the "gravitational" field of the statement.
      // Variables are near-weightless particles that flow between these attractors.
      let mass = isOperator ? system.c ** 2 : system.epsilon;

      // Right-directional operators (conclusions) are modeled with Negative Mass.
      // This repels the current logic path, forcing it to "fall" toward a new state.
      if (this.rightDirectionalRegex.test(token)) {
        mass *= -1;
      }

      // 2. Map the token to its unique Frequency Field (Scope).
      const scope = this.getSymbolScope(token);

      // 3. Materialize the token as a physical location in the System manifold.
      const id = system.createLocation(mass, scope);
      system.operatorClass[id] = classifyOperatorToken(token);
      sequenceIds[i] = id;

      // 4. Project the token into the Dual-Layer Manifold.
      // Matter Layer content:
      // Depth (Energy) and Time (Age) for logic atoms.
      system.depth[id] = isOperator ? 1.0 : 0.5;
      system.time[id] = i * 0.01;

      // Coordinate Layer positioning:
      // posX: Semantic relationship determined by UMAP 1D dimensionality reduction.
      system.posX[id] = this.loader.getScope(token);
      // posY: Structural kind coordinate.
      system.posY[id] = i * 0.1;
      // posZ: Energy coordinate (matches Depth content).
      system.posZ[id] = system.depth[id];
      // posW: Age coordinate (matches Time content).
      system.posW[id] = system.time[id];

      // Finalize derived properties.
      system.update(id);
    }

    return sequenceIds;
  }

  /**
   * Reconstructs the original string sequence from the high-frequency Scope parameters
   * of the precepts stored in the system.
   *
   * @param sequenceIds The sequence of quantum IDs to decode.
   * @param system The logical manifold containing the physical state.
   * @returns The reconstructed string statement.
   */
  public decodeSequence(sequenceIds: Uint32Array, system: System): string {
    const output: string[] = [];
    for (let i = 0; i < sequenceIds.length; i++) {
      const id = sequenceIds[i];
      // Resolve the symbol by reversing the Scope-to-Index mapping.
      output.push(this.resolveSymbolFromScope(system.scope[id]));
    }
    return output.join(" ");
  }
}
