import { OperatorClass } from "@core_i/System";

/**
 * SurfaceExpression - the expression-geometry complement of bulk perception.
 *
 * Perception (bulk): resonance waves converge inward through the potential
 * field, collapsing onto sink-candidate atoms.  The geodesic path that got
 * there mixes content atoms with logical connectives in traversal order -
 * semantically correct but syntactically scrambled.
 *
 * Expression (surface): from each sink candidate, expand outward along the
 * PartLayer / ComplexLayer chains - the linguistic topology laid down at
 * ingestion time.  These chains preserve the sentence order of the original
 * source text (Wikipedia sentences ingested by the Unfolder), so decoding
 * them produces coherent natural-language phrases instead of geodesic noise.
 *
 * The "flip" in geometry: perception follows ∇(potential) inward; expression
 * follows the PartLayer surface outward.
 */

/**
 * Operator classes that may appear in a natural-language answer phrase.
 * Purely logical operators (Sink "|-", Query, Intent, Capability, SyntaxAnchor)
 * are excluded - they are structural connectives of the manifold's inference
 * layer and do not decode to meaningful words in a spoken answer.
 */
const EXPRESSION_SAFE: ReadonlySet<number> = new Set([
  OperatorClass.None, // semantic content atoms
  OperatorClass.IdentityShift, // "is", "was", "are"
  OperatorClass.Conjunction, // "and", "but", "with"
  OperatorClass.Quantifier, // "all", "some", "every"
  OperatorClass.Modifier, // degree adverbs, adjectives
  OperatorClass.Inversion, // "not"
  OperatorClass.Action, // verbs - the most important connectives in prose
  OperatorClass.Arithmetic, // numbers and their operators
]);

/**
 * Walk the PartLayer surface backward (ComplexLayer) then forward (PartLayer)
 * from a seed atom, collecting atoms whose operator class is expression-safe.
 * Stops as soon as a non-safe atom is encountered in either direction.
 */
function collectSurfacePhrase(
  seedId: number,
  system: Root.ManifoldView,
  maxStepsEach = 12
): number[] {
  if (!system.isAllocated(seedId)) return [];

  const back: number[] = [];
  let k = system.ComplexLayer[seedId];
  while (k !== 0 && system.isAllocated(k) && back.length < maxStepsEach) {
    if (!EXPRESSION_SAFE.has(system.operatorClass[k])) break;
    back.unshift(k);
    k = system.ComplexLayer[k];
  }

  const fwd: number[] = [seedId];
  k = system.PartLayer[seedId];
  while (k !== 0 && system.isAllocated(k) && fwd.length < maxStepsEach) {
    if (!EXPRESSION_SAFE.has(system.operatorClass[k])) break;
    fwd.push(k);
    k = system.PartLayer[k];
  }

  return [...back, ...fwd];
}

/**
 * Score a surface phrase for relevance to the query.
 *
 * Higher score when:
 * - Atoms are heavy (high mass = frequently reinforced, confident knowledge)
 * - Atoms are novel (not already in the query - they are new information)
 * - Atoms are content atoms (OperatorClass.None)
 */
function scorePhrase(
  phraseIds: number[],
  querySet: Set<number>,
  system: Root.ManifoldView
): number {
  if (phraseIds.length === 0) return 0;
  let score = 0;
  for (const id of phraseIds) {
    const mass = Math.abs(system.mass[id]);
    const isContent = system.operatorClass[id] === OperatorClass.None;
    const isNovel = !querySet.has(id);
    score += mass * (isContent ? 1.5 : 0.7) * (isNovel ? 1.2 : 0.4);
  }
  return score / phraseIds.length;
}

/**
 * Express the answer to a query using the surface topology rather than the
 * bulk geodesic result.
 *
 * For each sink candidate identified by perceiveCoherent, walks the PartLayer
 * surface outward to collect the coherent phrase context that atom belongs to.
 * Ranks candidate phrases by mass-weighted novelty and returns the best one
 * decoded as natural-language text.
 *
 * Returns null when:
 * - No sink candidates have surface-traversable PartLayer chains (atoms were
 *   ingested in isolation, not as part of a text sequence), or
 * - Every collected phrase is too short or duplicates the query.
 * In that case the caller should fall back to decodeSequence on result.ids.
 */
export function expressFromSinks(
  sinkCandidates: Array<{ id: number; strength: number }>,
  queryIds: Uint32Array,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): string | null {
  if (sinkCandidates.length === 0) return null;

  const querySet = new Set(Array.from(queryIds));
  const seen = new Set<string>();
  const candidates: Array<{ text: string; score: number }> = [];

  for (const sink of sinkCandidates) {
    if (sink.strength <= 0) continue;
    if (!system.isAllocated(sink.id)) continue;
    // Start from content atoms or expression-safe atoms only
    if (!EXPRESSION_SAFE.has(system.operatorClass[sink.id])) continue;

    const phraseIds = collectSurfacePhrase(sink.id, system);
    // Require at least 3 atoms - single tokens aren't informative answers
    if (phraseIds.length < 3) continue;

    const text = atomizer
      .decodeSequence(new Uint32Array(phraseIds), system)
      .trim();
    if (!text || text.length < 6) continue;
    if (seen.has(text)) continue;
    seen.add(text);

    // Suppress phrases that are predominantly query echoes
    const novelCount = phraseIds.filter(id => !querySet.has(id)).length;
    if (novelCount / phraseIds.length < 0.4) continue;

    const score = sink.strength * scorePhrase(phraseIds, querySet, system);
    candidates.push({ text, score });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].text;
}
