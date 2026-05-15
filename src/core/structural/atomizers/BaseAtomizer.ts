import { SYSTEM_CONFIG } from "@src/config";
import { UMAPLoader } from "@core_s/UMAPLoader";

/**
 * All first-person pronouns are normalised to their canonical form before scope
 * computation.  This gives every "I", "me", "my", "we", "us" etc. the same scope
 * value — they constructively interfere in the resonance matrix and share the
 * same self-concept attractor in the manifold topology.
 *
 * The canonical form is "i" so that decoding a self-scope precept always returns
 * a recognisable, human-readable token.
 */
const PRONOUN_CANONICAL = new Map<string, string>([
  // First person — canonical self
  ["i", "i"],
  ["me", "i"],
  ["my", "i"],
  ["myself", "i"],
  ["mine", "i"],
  ["we", "i"],
  ["us", "i"],
  ["our", "i"],
  ["ours", "i"],
  ["ourselves", "i"],
  // Second person — in this system "you" is always the system itself, so it
  // shares the same scope as "i".  Any fact about "you" constructively interferes
  // with self-facts in the resonance matrix.
  ["you", "i"],
  ["your", "i"],
  ["yourself", "i"],
  ["yours", "i"],
]);

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
      SYSTEM_CONFIG.DOD_EMBEDDING.UMAP_BINARY_PATH,
      SYSTEM_CONFIG.DOD_EMBEDDING.UMAP_DICT_PATH
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
    const norm = symbol.toLowerCase().trim();
    const canonical = PRONOUN_CANONICAL.get(norm) ?? norm;
    const idx = this.getSymbolIdx(canonical);
    // Guard: operator indices must stay below the semantic band to prevent scope collisions.
    // Increase SEMANTIC_OFFSET in config if this fires.
    if (isOperator && idx >= SYSTEM_CONFIG.DOD_EMBEDDING.SEMANTIC_OFFSET) {
      throw new Error(
        `Operator band overflow: "${symbol}" idx=${idx} would collide with the semantic band ` +
          `(SEMANTIC_OFFSET=${SYSTEM_CONFIG.DOD_EMBEDDING.SEMANTIC_OFFSET}). ` +
          `Increase SEMANTIC_OFFSET or reduce the number of distinct operators.`
      );
    }
    const offset = isOperator
      ? SYSTEM_CONFIG.DOD_EMBEDDING.LOGIC_OFFSET
      : SYSTEM_CONFIG.DOD_EMBEDDING.SEMANTIC_OFFSET;
    return (idx + offset) * SYSTEM_CONFIG.DOD_EMBEDDING.BASE_FREQUENCY;
  }

  /**
   * Resolves a physical Scope (frequency) back into its original string symbol.
   * Reverses the mapping logic by identifying the frequency band and extracting the index.
   *
   * @param scope The physical frequency to decode.
   * @returns The original string symbol, or "<?>" if unknown.
   */
  protected resolveSymbolFromScope(scope: number): string {
    const normalizedScope = scope / SYSTEM_CONFIG.DOD_EMBEDDING.BASE_FREQUENCY;

    // Determine which field (Logic or Semantic) the scope belongs to.
    let symbolIdx: number;
    if (normalizedScope >= SYSTEM_CONFIG.DOD_EMBEDDING.SEMANTIC_OFFSET) {
      symbolIdx = normalizedScope - SYSTEM_CONFIG.DOD_EMBEDDING.SEMANTIC_OFFSET;
    } else {
      symbolIdx = normalizedScope - SYSTEM_CONFIG.DOD_EMBEDDING.LOGIC_OFFSET;
    }

    // Round to account for floating-point drift in the manifold.
    const cleanIdx = Math.round(symbolIdx);
    return this.reverseMap.get(cleanIdx) || "<?>";
  }

  /**
   * Public accessor for resolving a scope integer back to a string symbol.
   * Useful for external components that need to inspect the manifold.
   */
  public resolveScope(scope: number): string | undefined {
    const s = this.resolveSymbolFromScope(scope);
    return s === "<?>" ? undefined : s;
  }
}
