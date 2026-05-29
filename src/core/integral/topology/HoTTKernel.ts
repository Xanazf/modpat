/**
 * E3 - Homotopy Type Theory kernel.
 *
 * Maps HoTT primitives onto ModPAT's geodesic path type:
 *   refl(a)       →  zero-length traversal, identity holonomy
 *   symm(p)       →  reversed path, transposed holonomy
 *   trans(p, q)   →  concatenated paths via ProofPath.compose()
 *   pathEqual(p,q) →  winding-number homotopy check against H₁ generators
 *
 * Demo scope - not wired into production inference.
 * Depends on D2 (lastHolonomy) and D3 (detectHomotopy).
 */

import type { PersistenceBar } from "@core_s/PersistentHomology";
import {
  multiplyMatrices4x4,
  transposeMatrix4x4,
  identity4x4,
} from "@core_s/Math";

// --- ProofPath ----------------------------------------------------------------

/**
 * A typed traversal from atom `From` to atom `To`.
 *
 * Generic parameters are branded as `extends number` so TypeScript enforces
 * endpoint alignment at the type level: `p.compose(q)` only type-checks when
 * `p.to === q.from`.
 */
export class ProofPath<FromAtom extends number, ToAtom extends number> {
  constructor(
    public readonly from: FromAtom,
    public readonly to: ToAtom,
    /** Atom IDs along the path (inclusive of endpoints). */
    public readonly path: number[],
    /** 4×4 holonomy matrix accumulated along the path (matches D2 lastHolonomy). */
    public readonly holonomy: Float64Array,
    /** Action integral of the path (sum of step energies). */
    public readonly energy: number
  ) {}

  /**
   * Concatenate this path with `next`, composing holonomies.
   * `this.to` must equal `next.from` - enforced at the type level.
   */
  public compose<NextTo extends number>(
    next: ProofPath<ToAtom, NextTo>
  ): ProofPath<FromAtom, NextTo> {
    // Drop the duplicate join point (next.path[0] == this.path.at(-1)).
    const combinedPath = [...this.path, ...next.path.slice(1)];
    const combinedHolonomy = multiplyMatrices4x4(this.holonomy, next.holonomy);
    return new ProofPath(
      this.from,
      next.to,
      combinedPath,
      combinedHolonomy,
      this.energy + next.energy
    );
  }
}

// --- HoTT primitives ---------------------------------------------------------

/**
 * refl(a): the zero-length proof that a = a.
 * Holonomy = identity (no rotation along a degenerate path).
 */
export function refl<A extends number>(a: A): ProofPath<A, A> {
  return new ProofPath(a, a, [a], identity4x4(), 0);
}

/**
 * symm(p): reverse the path, establishing b = a from a = b.
 * Holonomy of symm(p) = transpose(H_p) - the inverse rotation.
 * (H is approximately orthogonal; for orthogonal matrices H⁻¹ = Hᵀ.)
 */
export function symm<A extends number, B extends number>(
  p: ProofPath<A, B>
): ProofPath<B, A> {
  return new ProofPath(
    p.to,
    p.from,
    [...p.path].reverse(),
    transposeMatrix4x4(p.holonomy),
    p.energy
  );
}

/**
 * trans(p, q): path concatenation - the transitivity combinator.
 * Equivalent to p.compose(q); kept as a named export for HoTT parity.
 */
export function trans<A extends number, B extends number, C extends number>(
  p: ProofPath<A, B>,
  q: ProofPath<B, C>
): ProofPath<A, C> {
  return p.compose(q);
}

// --- Path equality (homotopy check) ------------------------------------------

export interface PathEqualityResult {
  /** True when the loop path₁ + reversed(path₂) encloses no persistent H₁ generator. */
  homotopic: boolean;
  /** H₁ bars whose generators are enclosed by the loop (analogy candidates). */
  straddledH1Bars: PersistenceBar[];
  /** [0, 1] - fraction of qualified H₁ generators straddled. */
  analogyScore: number;
}

/**
 * pathEqual(p, q): check whether two paths between the same endpoints are
 * homotopic by testing whether their loop encloses a persistent H₁ generator.
 *
 * Equivalent to `detectHomotopy(p, q, h1Bars).homotopic` (D3).
 *
 * @param system     Manifold view for atom position lookups.
 * @param p          First path (p.from must equal q.from, p.to must equal q.to).
 * @param q          Second path.
 * @param h1Bars     H₁ persistence bars from the last topology tick.
 * @param minPersistence  Minimum bar lifetime to qualify. Default 0.
 */
export function pathEqual<A extends number, B extends number>(
  system: Root.ManifoldView,
  p: ProofPath<A, B>,
  q: ProofPath<A, B>,
  h1Bars: PersistenceBar[],
  minPersistence = 0
): PathEqualityResult {
  if (h1Bars.length === 0) {
    return { homotopic: true, straddledH1Bars: [], analogyScore: 0 };
  }

  // Build the loop = p forward + q reversed, in (posX, posY).
  const loop: [number, number][] = [];
  for (const id of p.path) {
    if (id < system.length && system.isAllocated(id)) {
      loop.push([system.posX[id], system.posY[id]]);
    }
  }
  for (let i = q.path.length - 1; i >= 0; i--) {
    const id = q.path[i];
    if (id < system.length && system.isAllocated(id)) {
      loop.push([system.posX[id], system.posY[id]]);
    }
  }

  if (loop.length < 3) {
    return { homotopic: true, straddledH1Bars: [], analogyScore: 0 };
  }

  const qualified = h1Bars.filter(b => b.death - b.birth > minPersistence);
  const straddled: PersistenceBar[] = [];

  for (const bar of qualified) {
    const id = bar.generatorAtomId;
    if (!system.isAllocated(id)) continue;
    const gx = system.posX[id];
    const gy = system.posY[id];
    if (windingNumber(loop, gx, gy) !== 0) straddled.push(bar);
  }

  const homotopic = straddled.length === 0;
  const analogyScore =
    qualified.length > 0 ? straddled.length / qualified.length : 0;
  return { homotopic, straddledH1Bars: straddled, analogyScore };
}

/** Non-zero winding number of a 2D polygon around point (gx, gy). */
function windingNumber(
  loop: [number, number][],
  gx: number,
  gy: number
): number {
  let wn = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % n];
    if (y1 <= gy) {
      if (y2 > gy && (x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1) > 0) wn++;
    } else {
      if (y2 <= gy && (x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1) < 0) wn--;
    }
  }
  return wn;
}
