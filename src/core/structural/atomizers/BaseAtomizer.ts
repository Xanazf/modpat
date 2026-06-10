import { UMAPLoader } from "@core_s/UMAPLoader";
import { DOPAT_CONFIG, SYSTEM_CONFIG } from "@src/config";

/**
 * All first-person pronouns are normalised to their canonical form before scope
 * computation.  This gives every "I", "me", "my", "we", "us" etc. the same scope
 * value - they constructively interfere in the resonance matrix and share the
 * same self-concept attractor in the manifold topology.
 *
 * The canonical form is "i" so that decoding a self-scope precept always returns
 * a recognisable, human-readable token.
 */
/**
 * Arithmetic symbols are normalised to their English word equivalents so that
 * "1 + 1 = 2" and "1 plus 1 equals 2" produce identical scope sequences and
 * therefore identical vault signatures.  Without this, the two forms would
 * live in completely separate manifold regions and never cross-resolve.
 */
const ARITHMETIC_CANONICAL = new Map<string, string>([
  ["+", "plus"],
  ["-", "minus"],
  ["*", "times"],
  ["/", "divided"],
  ["=", "equals"],
]);

/**
 * Function words excluded from the cold-start co-occurrence basis. The structural
 * channel grounds a first-seen word toward the *content* it is uttered alongside,
 * not toward syntactic glue. These copulas/articles/prepositions co-occur with
 * almost every utterance, so averaging them in would pull all novel words toward
 * a single shared centroid and destroy topic discrimination (e.g. "the grass is"
 * collapsing onto "the sky is"). Operators are excluded separately by class.
 */
export const COOCCURRENCE_STOPWORDS = new Set<string>([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "am",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "as",
  "from",
]);

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
    const canonical =
      PRONOUN_CANONICAL.get(norm) ?? ARITHMETIC_CANONICAL.get(norm) ?? norm;
    return this.getSymbolIdx(canonical);
  }

  /**
   * Resolves a scope back to its symbol string via direct map lookup.
   */
  public resolveScope(scope: number): string | undefined {
    return this.reverseMap.get(scope);
  }

  /**
   * Phase 5 - coordinate-source migration. Returns the posX a newly-ingested
   * token should land at, deriving it from the token's *referent* (an existing
   * grounded precept that shares the scope) rather than from GloVe co-occurrence.
   *
   * A referent is any already-allocated atom carrying the same scope - a code
   * symbol placed by structural grounding, or a prior settled mention. Among
   * candidates the highest-mass (most central / most grounded) one wins. When no
   * referent exists - the cold-start case, e.g. the first time a word is ever
   * seen - GloVe is used as the fallback hint (`coldStart`).
   *
   * `excludeId` is the atom currently being placed: it already carries the scope
   * (createLocation registered it in the scope index), so it must be skipped or
   * it would shadow the real referent with its own zero/unsettled position.
   *
   * `cooccurringScopes` is the scope multiset of the whole ingested sequence.
   * When the token has no direct referent (cold start) and
   * `COLD_START_COOCCURRENCE_ENABLED` is set, the position is taken from the mean
   * grounded posX of the *other* scopes in the sequence that DO have referents -
   * so even a first-seen word grounds toward the structurally-known symbols it is
   * uttered alongside, instead of jumping to its GloVe coordinate. Only when no
   * co-occurring referent exists either does it fall back to `coldStart`.
   *
   * Gated by `DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED`; when false this
   * returns `coldStart` unchanged (legacy GloVe behaviour).
   */
  protected groundedPosX(
    system: Root.ManifoldView,
    scope: number,
    coldStart: number,
    excludeId: number,
    cooccurringScopes?: Iterable<number>
  ): number {
    if (!DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED) return coldStart;
    const direct = this.referentPosX(system, scope, excludeId);
    if (!Number.isNaN(direct)) return direct;
    // Cold start: no direct referent. Ground toward co-occurring referents -
    // but ONLY structurally-grounded ones (code/logic/math symbols), never prior
    // language mentions. Bare sentence co-occurrence with an unrelated earlier
    // mention ("Tesla liked pie" after "Tesla invented electricity") must not
    // relocate the new word; only a real grounded referent earns the move. In a
    // language-only context (no grounded precepts) this makes cold-start inert.
    if (
      DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED &&
      cooccurringScopes
    ) {
      let sum = 0;
      let count = 0;
      for (const s of cooccurringScopes) {
        if (s === scope) continue;
        const r = this.referentPosX(system, s, excludeId, true);
        if (!Number.isNaN(r)) {
          sum += r;
          count++;
        }
      }
      if (count > 0) return sum / count;
    }
    return coldStart;
  }

  /**
   * Returns the grounded posX of the highest-mass already-allocated atom carrying
   * `scope` (the token's referent), or `NaN` when the scope has no such referent.
   * Highest mass = most central / most grounded. `excludeId` skips the atom being
   * placed. When `structuralOnly` is set, only referents created through the
   * structural grounding channel (`system.groundedPrecepts`) count - so a
   * cold-start word grounds toward a genuine grounded symbol, not toward an
   * unrelated prior language mention. Pure read; the caller gates on config.
   */
  protected referentPosX(
    system: Root.ManifoldView,
    scope: number,
    excludeId: number,
    structuralOnly = false
  ): number {
    let bestId = -1;
    let bestMass = -Infinity;
    for (const id of system.getIdsByScope(scope)) {
      if (id === excludeId || !system.isAllocated(id)) continue;
      if (structuralOnly && !system.groundedPrecepts.has(id)) continue;
      const m = system.mass[id];
      if (m > bestMass) {
        bestMass = m;
        bestId = id;
      }
    }
    return bestId === -1 ? Number.NaN : system.posX[bestId];
  }
}
