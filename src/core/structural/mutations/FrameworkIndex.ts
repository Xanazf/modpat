import { DOPAT_CONFIG } from "@config";
import type { NerveGraph } from "@core_s/TopologyMapper";

declare const __superBrand: unique symbol;
declare const __clusterBrand: unique symbol;
declare const __subBrand: unique symbol;
declare const __matrix4x4Brand: unique symbol;
export type SuperclusterId = number & { readonly __brand: typeof __superBrand };
export type ClusterId = number & { readonly __brand: typeof __clusterBrand };
export type SubclusterId = number & { readonly __brand: typeof __subBrand };
export type FrameworkId = SuperclusterId | ClusterId | SubclusterId;
export type Matrix4x4 = Float64Array & {
  readonly __brand: typeof __matrix4x4Brand;
};

// --- ManifoldRegion and fuzzy connectives (E1) --------------------------------

/** A weighted region of the manifold: atom ID → local φ (density) value. */
export type ManifoldRegion = Map<number, number>;

/** Fuzzy AND (Gödel t-norm): min(φ_A, φ_B) at each atom present in both regions. */
export function fuzzyAnd(a: ManifoldRegion, b: ManifoldRegion): ManifoldRegion {
  const result: ManifoldRegion = new Map();
  for (const [id, phiA] of a) {
    const phiB = b.get(id);
    if (phiB !== undefined) result.set(id, Math.min(phiA, phiB));
  }
  return result;
}

/** Fuzzy OR (Zadeh t-conorm): max(φ_A, φ_B) at each atom in the union. */
export function fuzzyOr(a: ManifoldRegion, b: ManifoldRegion): ManifoldRegion {
  const result: ManifoldRegion = new Map(a);
  for (const [id, phiB] of b) {
    const phiA = result.get(id);
    result.set(id, phiA !== undefined ? Math.max(phiA, phiB) : phiB);
  }
  return result;
}

/**
 * Fuzzy NOT within a universe region (supercluster complement).
 * complement(id) = max(0, φ_universe(id) − φ_A(id)).
 */
export function fuzzyNot(
  a: ManifoldRegion,
  universe: ManifoldRegion
): ManifoldRegion {
  const result: ManifoldRegion = new Map();
  for (const [id, phiU] of universe) {
    const phiA = a.get(id) ?? 0;
    const c = phiU - phiA;
    if (c > 0) result.set(id, c);
  }
  return result;
}

/**
 * Zadeh (1982) subsethood ratio: ∫min(φ_A, φ_B) / ∫φ_A.
 * 1 when A ⊆ B, 0 when supports are disjoint.  Use as the IMPLIES truth value.
 */
export function subsethood(a: ManifoldRegion, b: ManifoldRegion): number {
  let num = 0;
  let den = 0;
  for (const [id, phiA] of a) {
    den += phiA;
    num += Math.min(phiA, b.get(id) ?? 0);
  }
  return den === 0 ? 0 : num / den;
}

// --- Formula AST (E1) --------------------------------------------------------

export type FormulaNode =
  | { readonly type: "region"; region: ManifoldRegion }
  | { readonly type: "and"; left: FormulaNode; right: FormulaNode }
  | { readonly type: "or"; left: FormulaNode; right: FormulaNode }
  | { readonly type: "not"; child: FormulaNode; universe: ManifoldRegion }
  | { readonly type: "implies"; premise: FormulaNode; conclusion: FormulaNode };

/** Bottom-up fold: evaluate the formula tree to a ManifoldRegion. */
export function evalFormula(node: FormulaNode): ManifoldRegion {
  switch (node.type) {
    case "region":
      return node.region;
    case "and":
      return fuzzyAnd(evalFormula(node.left), evalFormula(node.right));
    case "or":
      return fuzzyOr(evalFormula(node.left), evalFormula(node.right));
    case "not":
      return fuzzyNot(evalFormula(node.child), node.universe);
    case "implies":
      // IMPLIES folds to the conjunction region; use `entailment()` for the scalar.
      return fuzzyAnd(evalFormula(node.premise), evalFormula(node.conclusion));
  }
}

/**
 * Entailment score for an IMPLIES node: Zadeh subsethood of premise ⊆ conclusion.
 * Returns a value in [0, 1].
 */
export function entailment(node: FormulaNode & { type: "implies" }): number {
  return subsethood(evalFormula(node.premise), evalFormula(node.conclusion));
}

// --- Build FrameworkIndex (E0) -----------------------------------------------

export function buildFrameworkIndex(
  system: Root.ManifoldView,
  nerveGraph: NerveGraph,
  opts?: Mutation.FrameworkBuildOpts
): Mutation.FrameworkIndex {
  const base = DOPAT_CONFIG.orbital.BASE_RADIUS;
  const rSub = opts?.rSub ?? base * 0.25;
  const rCluster = opts?.rCluster ?? base * 0.75;
  const rSuper = opts?.rSuper ?? base * 1.5;
  const nSeeds = opts?.seedsPerCluster ?? 2;

  const allocated: number[] = [];
  for (let i = 0; i < system.length; i++) {
    if (system.isAllocated(i)) allocated.push(i);
  }
  if (allocated.length === 0) {
    return {
      superclusters: [],
      clusters: [],
      subclusters: [],
      interstitial: new Set(),
      crossFrameEdges: [],
    };
  }

  const superComponents = ufComponents(allocated, system, rSuper);
  const clusterComponents = ufComponents(allocated, system, rCluster);
  const subComponents = ufComponents(allocated, system, rSub);

  const atomToSuperRep = atomToRepMap(superComponents);
  const atomToClusterRep = atomToRepMap(clusterComponents);

  const maxP = DOPAT_CONFIG.MAX_PRECEPTS;
  let superSeq = 1 * maxP;
  let clusterSeq = 2 * maxP;
  let subSeq = 3 * maxP;

  const superByRep = new Map<number, Mutation.SuperclusterTier>();
  const clusterByRep = new Map<number, Mutation.ClusterTier>();
  const subByRep = new Map<number, Mutation.SubclusterTier>();

  for (const [rep, atoms] of superComponents) {
    superByRep.set(rep, {
      id: superSeq++ as SuperclusterId,
      seedAtomIds: topByMass(atoms, system, nSeeds),
      memberAtomIds: new Set(atoms),
      childClusterIds: new Set(),
    });
  }

  for (const [rep, atoms] of clusterComponents) {
    const superRep = atomToSuperRep.get(atoms[0])!;
    const superTier = superByRep.get(superRep)!;
    const tier: Mutation.ClusterTier = {
      id: clusterSeq++ as ClusterId,
      parentSuperclusterId: superTier.id,
      seedAtomIds: topByMass(atoms, system, nSeeds),
      memberAtomIds: new Set(atoms),
      childSubclusterIds: new Set(),
    };
    clusterByRep.set(rep, tier);
    superTier.childClusterIds.add(tier.id);
  }

  const inSub = new Set<number>();
  for (const [rep, atoms] of subComponents) {
    const clusterRep = atomToClusterRep.get(atoms[0])!;
    const clusterTier = clusterByRep.get(clusterRep)!;
    const tier: Mutation.SubclusterTier = {
      id: subSeq++ as SubclusterId,
      parentClusterId: clusterTier.id,
      memberAtomIds: new Set(atoms),
    };
    subByRep.set(rep, tier);
    clusterTier.childSubclusterIds.add(tier.id);
    for (const a of atoms) inSub.add(a);
  }

  const interstitial = new Set<number>();
  for (const id of allocated) {
    if (!inSub.has(id)) interstitial.add(id);
  }

  // Cross-frame edges: topoInterest nerve edges bridging different superclusters.
  const crossFrameEdges: { from: number; to: number; persistence: number }[] =
    [];
  for (const edge of nerveGraph.edges) {
    if (!edge.topoInterest) continue;
    const nodeA = nerveGraph.nodes[edge.nodeA];
    const nodeB = nerveGraph.nodes[edge.nodeB];
    if (
      !nodeA ||
      !nodeB ||
      nodeA.atoms.length === 0 ||
      nodeB.atoms.length === 0
    )
      continue;
    const repA = atomToSuperRep.get(nodeA.atoms[0]);
    const repB = atomToSuperRep.get(nodeB.atoms[0]);
    if (repA !== undefined && repB !== undefined && repA !== repB) {
      const bar = nerveGraph.diagram.h1.find(b =>
        edge.commonAtoms.includes(b.generatorAtomId)
      );
      const persistence =
        bar && bar.death !== Infinity ? bar.death - bar.birth : 1.0;
      crossFrameEdges.push({
        from: nodeA.atoms[0],
        to: nodeB.atoms[0],
        persistence,
      });
    }
  }

  return {
    superclusters: [...superByRep.values()],
    clusters: [...clusterByRep.values()],
    subclusters: [...subByRep.values()],
    interstitial,
    crossFrameEdges,
  };
}

/**
 * Given a FrameworkIndex and a set of framework IDs (any mix of Supercluster,
 * Cluster, or SubclusterId), return the union of all member atom IDs.
 * Interstitial atoms are always included.
 */
export function resolveActiveAtoms(
  index: Mutation.FrameworkIndex,
  activeFrameworks: Set<number>
): Set<number> {
  const allowed = new Set<number>(index.interstitial);
  for (const sc of index.superclusters) {
    if (activeFrameworks.has(sc.id)) {
      for (const a of sc.memberAtomIds) allowed.add(a);
    }
  }
  for (const cl of index.clusters) {
    if (activeFrameworks.has(cl.id)) {
      for (const a of cl.memberAtomIds) allowed.add(a);
    }
  }
  for (const sub of index.subclusters) {
    if (activeFrameworks.has(sub.id)) {
      for (const a of sub.memberAtomIds) allowed.add(a);
    }
  }
  return allowed;
}

// --- Framework scope helpers (used by the vault for domain-scoped matching) ---

/**
 * Returns true when two concept scopes both have allocated atoms inside the
 * same SuperclusterTier of the current framework index.
 *
 * Only atoms that have settled away from the manifold pole are considered -
 * atoms still near the origin (|pos| ≤ POLE_DIST) were ingested but have not
 * yet drifted to their semantic positions and carry no reliable topology signal.
 *
 * Used by the vault to allow factual proofs to generalise to related concepts
 * within the same domain (e.g. an "iridium is dense" query can match a
 * "titanium is dense" proof once both live in the metallurgy supercluster)
 * while still rejecting cross-domain matches (sky → titanium).
 */
export function scopesInSameSupercluster(
  scopeA: number,
  scopeB: number,
  index: Mutation.FrameworkIndex,
  system: Root.ManifoldView
): boolean {
  if (scopeA === scopeB) return true;
  // Atoms within this radius of origin are considered unsettled (pole-position)
  // and are excluded from framework membership checks.
  const POLE_DIST_SQ = 0.25; // 0.5 units; 5× max pole jitter when enabled
  for (const sc of index.superclusters) {
    let hasA = false;
    let hasB = false;
    for (const id of sc.memberAtomIds) {
      const px = system.posX[id];
      const py = system.posY[id];
      const pz = system.posZ[id];
      if (px * px + py * py + pz * pz <= POLE_DIST_SQ) continue; // skip pole
      const s = system.scope[id];
      if (s === scopeA) hasA = true;
      else if (s === scopeB) hasB = true;
      if (hasA && hasB) return true;
    }
  }
  return false;
}

// --- private helpers ----------------------------------------------------------

function ufComponents(
  atoms: number[],
  system: Root.ManifoldView,
  radius: number
): Map<number, number[]> {
  const n = atoms.length;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  const r2 = radius * radius;
  for (let i = 0; i < n; i++) {
    const ai = atoms[i];
    for (let j = i + 1; j < n; j++) {
      const aj = atoms[j];
      const dx = system.posX[ai] - system.posX[aj];
      const dy = system.posY[ai] - system.posY[aj];
      const dz = system.posZ[ai] - system.posZ[aj];
      const dw = system.posW[ai] - system.posW[aj];
      if (dx * dx + dy * dy + dz * dz + dw * dw <= r2) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[rb] = ra;
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const rep = atoms[r];
    let g = groups.get(rep);
    if (!g) {
      g = [];
      groups.set(rep, g);
    }
    g.push(atoms[i]);
  }
  return groups;
}

function atomToRepMap(components: Map<number, number[]>): Map<number, number> {
  const m = new Map<number, number>();
  for (const [rep, atoms] of components) {
    for (const a of atoms) m.set(a, rep);
  }
  return m;
}

function topByMass(
  atoms: number[],
  system: Root.ManifoldView,
  n: number
): number[] {
  return [...atoms]
    .sort((a, b) => Math.abs(system.mass[b]) - Math.abs(system.mass[a]))
    .slice(0, n);
}
