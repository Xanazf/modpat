import { UMAPLoader } from "@core_s/UMAPLoader";
import { SYSTEM_CONFIG } from "@src/config";

/**
 * All first-person pronouns are normalised to their canonical form before scope
 * computation.  This gives every "I", "me", "my", "we", "us" etc. the same scope
 * value - they constructively interfere in the resonance matrix and share the
 * same self-concept attractor in the manifold topology.
 *
 * The canonical form is "i" so that decoding a self-scope precept always returns
 * a recognisable, human-readable token.
 */
const PRONOUN_CANONICAL = new Map<string, string>([
  // First person - canonical self
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
  // Second person - in this system "you" is always the system itself, so it
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
   * Returns the stable scope (identity tag) for a symbol.
   *
   * Scope is now a plain sequential integer - the symbol's registration index.
   * It carries no type information; atom type lives exclusively in
   * system.operatorClass[id].  The isOperator parameter is accepted for call-site
   * compatibility but has no effect on the returned value.
   */
  public getSymbolScope(symbol: string, _isOperator?: boolean): number {
    const norm = symbol.toLowerCase().trim();
    const canonical = PRONOUN_CANONICAL.get(norm) ?? norm;
    return this.getSymbolIdx(canonical);
  }

  /**
   * Resolves a scope back to its symbol string via direct map lookup.
   */
  public resolveScope(scope: number): string | undefined {
    return this.reverseMap.get(scope);
  }
}
