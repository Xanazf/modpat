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
