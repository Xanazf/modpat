import { BRAIN_CONFIG } from "@src/config";
import { UMAPLoader } from "./UMAPLoader";

/**
 * BaseAtomizer: Foundational logic for symbol-to-topology mapping.
 * It manages the "Heat Field" of available symbols and their base frequencies,
 * acting as the primary translator between discrete language and continuous manifold properties.
 */
export abstract class BaseAtomizer {
  /** Map of string symbols to their unique internal indices. */
  protected symbolMap: Map<string, number> = new Map();
  /** Reverse map for decoding indices back into string symbols. */
  protected reverseMap: Map<number, string> = new Map();
  /** The next available index for a new symbol. 0 is reserved for the "Vacuum" (null). */
  protected nextIdx = 1;
  /** Loader for UMAP-reduced embeddings to assist in topological positioning. */
  protected loader: UMAPLoader;

  /**
   * Initializes the atomizer and its UMAP dependency.
   */
  constructor() {
    this.loader = new UMAPLoader(
      BRAIN_CONFIG.DOD_EMBEDDING.UMAP_BINARY_PATH,
      BRAIN_CONFIG.DOD_EMBEDDING.UMAP_DICT_PATH
    );
  }

  /**
   * Registers or retrieves a unique index for a given symbol.
   *
   * @param symbol The raw string token.
   * @returns A unique integer identifier for the symbol.
   */
  protected getSymbolIdx(symbol: string): number {
    const s = symbol.toLowerCase().trim();
    if (!this.symbolMap.has(s)) {
      this.symbolMap.set(s, this.nextIdx);
      this.reverseMap.set(this.nextIdx, s);
      this.nextIdx++;
    }
    return this.symbolMap.get(s)!;
  }

  /**
   * Calculates the Base Frequency (Scope) for a given symbol.
   * In the logical manifold, symbols are distinguished by their structural "frequency".
   * Logic operators are offset into a higher "Heat Field" than semantic operands
   * to ensure they act as dominant attractors in the topology.
   *
   * @param symbol The string token to map.
   * @param isOperator Whether the token is a logical operator.
   * @returns The calculated physical scope (frequency).
   */
  public getSymbolScope(symbol: string, isOperator: boolean): number {
    const idx = this.getSymbolIdx(symbol);
    // Apply an offset to separate logical and semantic frequency bands.
    const offset = isOperator
      ? BRAIN_CONFIG.DOD_EMBEDDING.LOGIC_OFFSET
      : BRAIN_CONFIG.DOD_EMBEDDING.SEMANTIC_OFFSET;
    return (idx + offset) * BRAIN_CONFIG.DOD_EMBEDDING.BASE_FREQUENCY;
  }

  /**
   * Resolves a physical Scope (frequency) back into its original string symbol.
   * Reverses the mapping logic by identifying the frequency band and extracting the index.
   *
   * @param scope The physical frequency to decode.
   * @returns The original string symbol, or "<?>" if unknown.
   */
  protected resolveSymbolFromScope(scope: number): string {
    const normalizedScope = scope / BRAIN_CONFIG.DOD_EMBEDDING.BASE_FREQUENCY;

    // Determine which field (Logic or Semantic) the scope belongs to.
    let symbolIdx: number;
    if (normalizedScope >= BRAIN_CONFIG.DOD_EMBEDDING.SEMANTIC_OFFSET) {
      symbolIdx = normalizedScope - BRAIN_CONFIG.DOD_EMBEDDING.SEMANTIC_OFFSET;
    } else {
      symbolIdx = normalizedScope - BRAIN_CONFIG.DOD_EMBEDDING.LOGIC_OFFSET;
    }

    // Round to account for floating-point drift in the manifold.
    const cleanIdx = Math.round(symbolIdx);
    return this.reverseMap.get(cleanIdx) || "<?>";
  }
}
