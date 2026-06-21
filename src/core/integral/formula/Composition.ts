/**
 * Concept composition: fire ⊕ water → steam (and back).
 *
 * Two parent concepts combine into a product by MODULATION, not superposition.
 * Superposition (vector add) is lossy - opposites cancel, parents unrecoverable
 * (that is the WaveResolver's contradiction channel). Modulation multiplies the
 * parent waves and deposits BOTH into the product as sidebands (the sum and
 * difference of the parent frequencies), so the product is invertible: from
 * steam you recover fire and water.
 *
 * Two independent recovery channels, each validated by a probe:
 *
 *  - FREQUENCY / scope  (scripts/dev/modulation_roundtrip_probe.ts)
 *    The parents' scope-frequencies become sidebands carried in steam's COMPOUND
 *    scope. A continuous position cannot pack two points into one (3 < 6 DOF),
 *    but bounded integer scopes pack losslessly into one via a pairing function -
 *    discrete identity is recoverable where continuous coordinates are not. So
 *    `decompose()` recovers both parent scopes EXACTLY, position-independently.
 *
 *  - POSITION / geometry  (scripts/dev/composition_descent_probe.ts)
 *    steam is placed in the INFLUENCE-OVERLAP of both parents (the lens where
 *    both wells reach, bounded by √(R²−(sep/2)²)), so settling from steam drains
 *    to both parents with no stored edges. Holds while steam stays in the overlap;
 *    a parent outside steam's influence, or an asymmetric lean past the saddle,
 *    is where the frequency channel (always exact) carries the recovery instead.
 *
 * Pure scope arithmetic (compose/decomposeScope) is separated from the manifold
 * mutation (compose) so the encoding is unit-testable without a System.
 */

import { DOPAT_CONFIG } from "@config";

/**
 * Compound scopes live in a reserved high range so `isComposed` is a pure range
 * test and a product's scope never collides with a primitive concept's id.
 * 2^44 sits far above any vocabulary index yet far below MAX_SAFE_INTEGER (2^53),
 * leaving headroom for the paired payload.
 */
const COMPOSED_SCOPE_BASE = 2 ** 44;

/** The recoverable contents of a composed (product) concept's scope. */
export interface ScopeDecomposition {
  /** The two parent scope-frequencies (ascending), recovered exactly. */
  parents: [number, number];
  /** Modulation sidebands: sum = f₁+f₂, diff = |f₁−f₂| (the carried spectrum). */
  sidebands: { sum: number; diff: number };
}

/** Cantor pairing π(k₁,k₂) - a lossless bijection ℕ² → ℕ for bounded integers. */
function cantorPair(k1: number, k2: number): number {
  const s = k1 + k2;
  return (s * (s + 1)) / 2 + k2;
}

/** Inverse Cantor pairing. Exact for z < 2^53 (sqrt stays in integer precision). */
function cantorUnpair(z: number): [number, number] {
  const w = Math.floor((Math.sqrt(8 * z + 1) - 1) / 2);
  const t = (w * (w + 1)) / 2;
  const k2 = z - t;
  const k1 = w - k2;
  return [k1, k2];
}

/**
 * Encode two parent scope-frequencies into one compound product scope. Parents
 * are ordered ascending so composition is symmetric (fire⊕water = water⊕fire).
 */
export function composeScope(scopeA: number, scopeB: number): number {
  const lo = Math.min(scopeA, scopeB);
  const hi = Math.max(scopeA, scopeB);
  return COMPOSED_SCOPE_BASE + cantorPair(lo, hi);
}

/** True when a scope was produced by {@link composeScope}. */
export function isComposed(scope: number): boolean {
  return scope >= COMPOSED_SCOPE_BASE && Number.isInteger(scope);
}

/**
 * Recover the two parent scope-frequencies (and their sidebands) from a compound
 * product scope, or null when the scope is primitive (not a composition).
 */
export function decomposeScope(scope: number): ScopeDecomposition | null {
  if (!isComposed(scope)) return null;
  const [lo, hi] = cantorUnpair(scope - COMPOSED_SCOPE_BASE);
  return {
    parents: [lo, hi],
    sidebands: { sum: hi + lo, diff: hi - lo },
  };
}

/**
 * Compose two existing concept atoms into a new product atom.
 *
 * Position: the mass-weighted centroid of the parents - for equal masses the
 * midpoint, which lies in the influence-overlap when the parents are within each
 * other's influence (the descent-recovery precondition). Scope: the sideband-
 * carrying compound scope. Mass: the parents' combined energy.
 *
 * Returns the new atom id, or -1 if either parent is unallocated.
 */
export function compose(
  aId: number,
  bId: number,
  system: Root.ManifoldView
): number {
  if (!system.isAllocated(aId) || !system.isAllocated(bId)) return -1;

  const mA = Math.abs(system.mass[aId]);
  const mB = Math.abs(system.mass[bId]);
  const wsum = mA + mB || 1;
  const lerp = (a: number, b: number) => (mA * a + mB * b) / wsum;

  const scope = composeScope(system.scope[aId], system.scope[bId]);
  const steamId = system.createLocation(
    system.mass[aId] + system.mass[bId],
    scope,
    "compose"
  );
  system.posX[steamId] = lerp(system.posX[aId], system.posX[bId]);
  system.posY[steamId] = lerp(system.posY[aId], system.posY[bId]);
  system.posZ[steamId] = lerp(system.posZ[aId], system.posZ[bId]);
  // posW is the number-line/age axis, not part of the spatial blend: the product
  // is a freshly-minted concept, so it starts maximally recent.
  system.posW[steamId] = DOPAT_CONFIG.PHYSICS.AGE_FRESHNESS;
  system.update(steamId, "compose");
  return steamId;
}

// -- Query path (step 12) ----------------------------------------------------
// Operator-class codes (mirror helpers/enums.ts; keep this file import-light).
const OC_NONE = 0;

/**
 * Function words that are neither parents nor a product name in a composition
 * query - the grammatical scaffold of "what is X made of" / "A and B make Z".
 */
const COMPOSE_STOPWORDS = new Set([
  "what",
  "is",
  "are",
  "was",
  "made",
  "composed",
  "of",
  "a",
  "an",
  "the",
  "and",
  "with",
  "from",
  "into",
  "to",
  "do",
  "does",
  "it",
]);

/** Verbs that signal "combine the preceding concepts into the following one". */
const COMPOSE_TRIGGERS = new Set([
  "make",
  "makes",
  "made",
  "form",
  "forms",
  "formed",
  "combine",
  "combines",
  "combined",
  "mix",
  "mixes",
  "mixed",
  "yield",
  "yields",
  "produce",
  "produces",
]);

/**
 * Resolve a composition query off the manifold (step 12 - compose/decompose
 * wired into a query path). Two shapes, both returning the answer's atom ids or
 * null when the input is not a composition query (so the caller falls through):
 *
 *  - SYNTHESIS:  "A and B make Z"  → compose A⊕B into a product atom and bind the
 *    name Z to its compound scope (Z now IS the composition). Returns [product].
 *  - DECOMPOSE:  "what is Z made of" → if Z carries a compound scope, recover and
 *    emit its two parents by name ("A and B"). The decompose-as-traversal answer.
 *
 * Pure read of scope/operatorClass + the existing compose/decomposeScope; the
 * only mutation is the synthesis product (and its name binding), mirroring how the
 * reduction fast-path mints a reduct.
 */
export function resolveCompositionQuery(
  ids: Uint32Array,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): Uint32Array | null {
  const N = ids.length;
  if (N < 3) return null;
  const wordOf = (id: number): string =>
    (atomizer.resolveScope(system.scope[id]) ?? "").toLowerCase().trim();
  const words = Array.from(ids, wordOf);
  const isConcept = (i: number): boolean =>
    system.operatorClass[ids[i]] === OC_NONE &&
    words[i].length > 0 &&
    !COMPOSE_STOPWORDS.has(words[i]) &&
    !COMPOSE_TRIGGERS.has(words[i]) &&
    !/^-?\d+$/.test(words[i]);

  // -- DECOMPOSE: "... Z made of" / "... Z composed of" ----------------------
  const ofIdx = words.findIndex(
    (w, i) => (w === "made" || w === "composed") && words[i + 1] === "of"
  );
  if (ofIdx > 0) {
    for (let i = ofIdx - 1; i >= 0; i--) {
      if (!isConcept(i)) continue;
      const dec = decomposeScope(system.scope[ids[i]]);
      if (!dec) return null; // named concept, but not a composition
      const a = atomizer.resolveScope(dec.parents[0]);
      const b = atomizer.resolveScope(dec.parents[1]);
      if (a && b) return atomizer.ingestSequence(`${a} and ${b}`, system);
      return null;
    }
    return null;
  }

  // -- SYNTHESIS: "A and B make Z" -------------------------------------------
  const tIdx = words.findIndex(w => COMPOSE_TRIGGERS.has(w));
  if (tIdx > 0) {
    const before: number[] = [];
    const after: number[] = [];
    for (let i = 0; i < N; i++) {
      if (i === tIdx || !isConcept(i)) continue;
      (i < tIdx ? before : after).push(i);
    }
    if (before.length < 2) return null;
    // First and last distinct concepts before the trigger are the two parents.
    const aId = ids[before[0]];
    const bId = ids[before[before.length - 1]];
    if (aId === bId) return null;
    const productId = compose(aId, bId, system);
    if (productId < 0) return null;
    // Bind the product name (the concept after the trigger), if given, so a later
    // "what is Z made of" recovers the parents.
    if (after.length > 0) {
      atomizer.bindSymbolScope(words[after[0]], system.scope[productId]);
    }
    return new Uint32Array([productId]);
  }

  return null;
}

/** A product atom decomposed back into its parents' live atom ids. */
export interface Decomposition extends ScopeDecomposition {
  /** Allocated atoms carrying each parent scope (empty if the parent is gone). */
  parentIds: [number[], number[]];
}

/**
 * Recover a product atom's parents: the exact parent scopes from the sidebands,
 * plus the live atoms (if any) carrying those scopes. Returns null when the atom
 * is not a composition.
 */
export function decompose(
  steamId: number,
  system: Root.ManifoldView
): Decomposition | null {
  const dec = decomposeScope(system.scope[steamId]);
  if (!dec) return null;
  const idsFor = (scope: number) =>
    [...system.getIdsByScope(scope)].filter(id => system.isAllocated(id));
  return {
    ...dec,
    parentIds: [idsFor(dec.parents[0]), idsFor(dec.parents[1])],
  };
}
