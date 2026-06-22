import { distance4DPoints } from "@_lib/math/TensorMath";
import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import { DOPAT_CONFIG } from "@config";
import { computeCurvature } from "@props/Curvature";

/**
 * Persistent homology (H₀ and H₁) of the Vietoris–Rips complex built on the
 * top-K atoms by |mass|.
 *
 * H₀ (connected components): union-find sweep over edges sorted by distance.
 * H₁ (1-cycles): boundary-matrix column reduction over GF(2), restricted to
 *   the free edges (those that do not merge components in H₀).
 *
 * No external library. O(K²) edges, O(K³) 2-simplices worst-case.
 */
export function computePersistentHomology(
  system: Root.ManifoldView,
  opts?: Topology.PersistenceOpts
): Topology.PersistenceDiagram {
  const topK = opts?.topK ?? 500;
  const maxRadius = opts?.maxRadius ?? DOPAT_CONFIG.orbital.BASE_RADIUS * 2;

  const atoms = selectTopK(system, topK);
  if (atoms.length < 2) return { h0: [], h1: [] };

  const edges = buildEdges(atoms, system, maxRadius);
  const h0 = computeH0(atoms, edges, system);
  const h1 = computeH1(atoms, edges, system);

  return { h0, h1 };
}

// --- atom selection ---------------------------------------------------------

function selectTopK(system: Root.ManifoldView, k: number): number[] {
  const candidates: { id: number; mass: number }[] = [];
  for (let i = 0; i < system.length; i++) {
    if (system.isAllocated(i)) {
      candidates.push({ id: i, mass: Math.abs(system.mass[i]) });
    }
  }
  candidates.sort((a, b) => b.mass - a.mass);
  return candidates.slice(0, k).map(x => x.id);
}

// --- edge list --------------------------------------------------------------

function buildEdges(
  atoms: number[],
  system: Root.ManifoldView,
  maxRadius: number
): Topology.PHEdge[] {
  const n = atoms.length;

  // Build GridIndex4D for neighbourhood queries
  const phys = DOPAT_CONFIG.PHYSICS;
  const actualRadius = Math.sqrt(phys.INFLUENCE_RADIUS);
  const grid = new GridIndex4D(Math.max(actualRadius, 0.5));
  grid.buildFromSystem(system);

  // Precompute phi for each of the topK atoms
  const phi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const ai = atoms[i];
    phi[i] = computeCurvature(
      system,
      grid,
      system.posX[ai],
      system.posY[ai],
      system.posZ[ai],
      system.posW[ai]
    ).phi;
  }

  const edges: Topology.PHEdge[] = [];
  const conformalEnabled = phys.CONFORMAL_ENABLED;

  for (let i = 0; i < n; i++) {
    const ai = atoms[i];
    for (let j = i + 1; j < n; j++) {
      const aj = atoms[j];
      let dist = distance4DPoints(
        system.posX[ai],
        system.posY[ai],
        system.posZ[ai],
        system.posW[ai],
        system.posX[aj],
        system.posY[aj],
        system.posZ[aj],
        system.posW[aj]
      );

      if (conformalEnabled) {
        // Conformal metric scale factor: g_ij = e^{2phi} delta_ij
        // The distance scale factor is e^{phi}. We use the average phi.
        // We cap the scaling factor at 10.0 to prevent numerical truncation of edges
        // under pathological densities (where phi can be up to PHI_MAX = 50.0).
        const avgPhi = (phi[i] + phi[j]) / 2;
        const scale = Math.min(10.0, Math.exp(avgPhi));
        dist *= scale;
      }

      if (dist <= maxRadius) edges.push({ a: i, b: j, dist });
    }
  }
  edges.sort((a, b) => a.dist - b.dist);
  return edges;
}

// --- union-find (path compression, union by mass) ---------------------------

class MassUF {
  private parent: Int32Array;
  /** Representative atom index (into atoms[]) for each UF root. */
  readonly rep: Int32Array;
  readonly repMass: Float64Array;

  constructor(n: number, atoms: number[], system: Root.ManifoldView) {
    this.parent = new Int32Array(n);
    this.rep = new Int32Array(n);
    this.repMass = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.parent[i] = i;
      this.rep[i] = i;
      this.repMass[i] = Math.abs(system.mass[atoms[i]]);
    }
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  /** Union, returning { survivor, killed } roots, or null if already same component. */
  union(a: number, b: number): { survivor: number; killed: number } | null {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return null;

    const [survivor, killed] =
      this.repMass[ra] >= this.repMass[rb] ? [ra, rb] : [rb, ra];
    this.parent[killed] = survivor;
    return { survivor, killed };
  }

  connected(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }
}

// --- H₀ ---------------------------------------------------------------------

function computeH0(
  atoms: number[],
  edges: Topology.PHEdge[],
  system: Root.ManifoldView
): Topology.PersistenceBar[] {
  const n = atoms.length;
  const uf = new MassUF(n, atoms, system);
  const bars: Topology.PersistenceBar[] = [];

  for (const edge of edges) {
    const result = uf.union(edge.a, edge.b);
    if (result) {
      bars.push({
        birth: 0,
        death: edge.dist,
        generatorAtomId: atoms[uf.rep[result.killed]],
      });
    }
  }

  // One infinite bar per surviving disconnected component.
  const roots = new Set<number>();
  for (let i = 0; i < n; i++) roots.add(uf.find(i));
  for (const r of roots) {
    bars.push({
      birth: 0,
      death: Infinity,
      generatorAtomId: atoms[uf.rep[r]],
    });
  }

  return bars;
}

// --- H₁ ---------------------------------------------------------------------

/** XOR two sorted (ascending) index arrays in-place on `target`. */
function xorSortedInPlace(target: number[], other: number[]): void {
  const result: number[] = [];
  let i = 0;
  let j = 0;
  const lenT = target.length;
  const lenO = other.length;

  while (i < lenT && j < lenO) {
    const valT = target[i];
    const valO = other[j];
    if (valT < valO) {
      result.push(valT);
      i++;
    } else if (valT > valO) {
      result.push(valO);
      j++;
    } else {
      // Elements are equal, they cancel out in GF(2)
      i++;
      j++;
    }
  }

  while (i < lenT) {
    result.push(target[i]);
    i++;
  }
  while (j < lenO) {
    result.push(other[j]);
    j++;
  }

  target.length = result.length;
  for (let k = 0; k < result.length; k++) {
    target[k] = result[k];
  }
}

function computeH1(
  atoms: number[],
  edges: Topology.PHEdge[],
  _system: Root.ManifoldView
): Topology.PersistenceBar[] {
  const n = atoms.length;

  // Pass 1: mark H₀-merge edges via a fresh union-find.
  const uf = new SimpleUF(n);
  const isMerge = new Uint8Array(edges.length);
  for (let ei = 0; ei < edges.length; ei++) {
    const { a, b } = edges[ei];
    if (!uf.connected(a, b)) {
      uf.union(a, b);
      isMerge[ei] = 1;
    }
  }

  // Pass 2: index free edges (potential 1-cycle generators).
  const freeIdx = new Int32Array(edges.length).fill(-1);
  const free: Topology.PHEdge[] = [];
  for (let ei = 0; ei < edges.length; ei++) {
    if (!isMerge[ei]) {
      freeIdx[ei] = free.length;
      free.push(edges[ei]);
    }
  }
  if (free.length === 0) return [];

  // Pass 3: build edge adjacency for triangle enumeration.
  const adjHigh = new Map<number, Set<number>>(); // atom i → neighbours j > i
  const edgeOfPair = new Map<number, number>(); // packed pair key → edge index

  for (let ei = 0; ei < edges.length; ei++) {
    const { a, b } = edges[ei];
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const key = lo * (n + 1) + hi;
    edgeOfPair.set(key, ei);
    if (!adjHigh.has(lo)) adjHigh.set(lo, new Set());
    adjHigh.get(lo)!.add(hi);
  }

  // Pass 4: enumerate triangles (a < b < c, all three edges present).
  const triangles: Topology.PHTriangle[] = [];

  for (let a = 0; a < n; a++) {
    const nbA = adjHigh.get(a);
    if (!nbA) continue;
    for (const b of nbA) {
      const nbB = adjHigh.get(b);
      if (!nbB) continue;
      for (const c of nbB) {
        if (c <= b) continue;
        // Need edge (a,c).
        const key_ac = a * (n + 1) + c;
        if (!edgeOfPair.has(key_ac)) continue;

        const ei_ab = edgeOfPair.get(a * (n + 1) + b)!;
        const ei_bc = edgeOfPair.get(b * (n + 1) + c)!;
        const ei_ac = edgeOfPair.get(key_ac)!;

        const filtDist = Math.max(
          edges[ei_ab].dist,
          edges[ei_bc].dist,
          edges[ei_ac].dist
        );

        const col: number[] = [];
        if (freeIdx[ei_ab] >= 0) col.push(freeIdx[ei_ab]);
        if (freeIdx[ei_bc] >= 0) col.push(freeIdx[ei_bc]);
        if (freeIdx[ei_ac] >= 0) col.push(freeIdx[ei_ac]);
        col.sort((x, y) => x - y);

        triangles.push({ filtDist, col, repAtomId: atoms[a] });
      }
    }
  }

  // Sort triangles by filtration value (max edge dist).
  triangles.sort((a, b) => a.filtDist - b.filtDist);

  // Pass 5: GF(2) column reduction of D₂ over free-edge rows.
  // pivotFor[r] = triangle index j whose reduced column has low = r.
  const pivotFor = new Map<number, number>();
  const columns = triangles.map(t => [...t.col]);
  const paired = new Uint8Array(free.length);
  const bars: Topology.PersistenceBar[] = [];

  for (let j = 0; j < triangles.length; j++) {
    const col = columns[j];

    while (col.length > 0) {
      const low = col[col.length - 1];
      const prev = pivotFor.get(low);
      if (prev === undefined) break;
      xorSortedInPlace(col, columns[prev]);
    }

    if (col.length > 0) {
      const low = col[col.length - 1];
      pivotFor.set(low, j);
      paired[low] = 1;
      bars.push({
        birth: free[low].dist,
        death: triangles[j].filtDist,
        generatorAtomId: atoms[free[low].a],
      });
    }
  }

  // Unpaired free edges → essential H₁ (birth = edge dist, death = ∞).
  for (let fi = 0; fi < free.length; fi++) {
    if (!paired[fi]) {
      bars.push({
        birth: free[fi].dist,
        death: Infinity,
        generatorAtomId: atoms[free[fi].a],
      });
    }
  }

  return bars;
}

// --- simple union-find (rank only, no mass tracking) ------------------------

class SimpleUF {
  private p: Int32Array;
  private r: Uint8Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    this.r = new Uint8Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(x: number): number {
    while (this.p[x] !== x) {
      this.p[x] = this.p[this.p[x]];
      x = this.p[x];
    }
    return x;
  }
  connected(a: number, b: number): boolean {
    return this.find(a) === this.find(b);
  }
  union(a: number, b: number): void {
    a = this.find(a);
    b = this.find(b);
    if (a === b) return;
    if (this.r[a] < this.r[b]) {
      const t = a;
      a = b;
      b = t;
    }
    this.p[b] = a;
    if (this.r[a] === this.r[b]) this.r[a]++;
  }
}
