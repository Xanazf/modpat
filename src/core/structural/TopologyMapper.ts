import { DOPAT_CONFIG } from "@config";
import {
  computePersistentHomology,
  type PersistenceBar,
  type PersistenceDiagram,
} from "./PersistentHomology";

export type { PersistenceBar, PersistenceDiagram };

export type LensType = "posX" | "mass" | "density";

export interface MapperNode {
  id: number;
  atoms: number[];
  /** Centre of the lens interval that produced this cluster. */
  lensValue: number;
  clusterCenter: [number, number, number, number];
  /** Human-readable: "posX:3" = third cluster along the posX lens. */
  label: string;
}

export interface MapperEdge {
  nodeA: number;
  nodeB: number;
  commonAtoms: number[];
  /** True when this edge straddles a persistent H₁ loop. */
  topoInterest: boolean;
}

export interface NerveGraph {
  nodes: MapperNode[];
  edges: MapperEdge[];
  /** Persistence diagram used to annotate edges. */
  diagram: PersistenceDiagram;
}

export interface MapperOpts {
  lens?: LensType;
  numIntervals?: number;
  /** Fractional overlap in [0, 1) between adjacent lens intervals. Default 0.5. */
  overlap?: number;
  minClusterSize?: number;
  /** Single-linkage clustering threshold in 4D. Default INFLUENCE_RADIUS / 4. */
  clusterRadius?: number;
  topK?: number;
  maxRadius?: number;
}

/**
 * TDA Mapper over the manifold.
 *
 * Lens functions: posX (semantic axis), mass (operator hierarchy), density (φ proxy).
 * Cover: N equally-spaced intervals with fractional overlap.
 * Clustering: single-linkage in 4D within each interval.
 * Nerve graph: nodes = clusters, edges = non-empty intersections.
 * Topology annotation: nerve edges that straddle a persistent H₁ generator are
 *   flagged as "high topological interest".
 */
export function buildNerveGraph(
  system: Root.ManifoldView,
  opts?: MapperOpts
): NerveGraph {
  const lens = opts?.lens ?? "posX";
  const numIntervals = opts?.numIntervals ?? 10;
  const overlap = Math.max(0, Math.min(0.99, opts?.overlap ?? 0.5));
  const minClusterSize = opts?.minClusterSize ?? 2;
  const clusterRadius =
    opts?.clusterRadius ?? DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS / 4;
  const topK = opts?.topK ?? 500;
  const maxRadius = opts?.maxRadius ?? DOPAT_CONFIG.orbital.BASE_RADIUS * 2;

  // Compute persistent homology first (for edge annotation).
  const diagram = computePersistentHomology(system, { topK, maxRadius });

  // Collect allocated atoms.
  const allocated: number[] = [];
  for (let i = 0; i < system.length; i++) {
    if (system.isAllocated(i)) allocated.push(i);
  }
  if (allocated.length === 0) {
    return { nodes: [], edges: [], diagram };
  }

  // Lens values.
  const lensVal = lensValues(allocated, system, lens);

  // Cover range.
  let lmin = lensVal[0];
  let lmax = lensVal[0];
  for (const v of lensVal) {
    if (v < lmin) lmin = v;
    if (v > lmax) lmax = v;
  }
  if (lmax === lmin) lmax = lmin + 1; // degenerate case

  const intervalWidth =
    (lmax - lmin) / (numIntervals * (1 - overlap) + overlap);
  const step = intervalWidth * (1 - overlap);

  // For each interval: collect atoms, cluster, produce MapperNodes.
  const nodes: MapperNode[] = [];
  let globalNodeId = 0;

  // Track which atoms belong to which nodes (for nerve construction).
  const atomToNodes = new Map<number, number[]>(); // atomId → nodeId[]

  for (let k = 0; k < numIntervals; k++) {
    const lo = lmin + k * step;
    const hi = lo + intervalWidth;

    const inInterval: number[] = [];
    for (let i = 0; i < allocated.length; i++) {
      if (lensVal[i] >= lo && lensVal[i] <= hi) {
        inInterval.push(allocated[i]);
      }
    }
    if (inInterval.length < minClusterSize) continue;

    const clusters = singleLinkage(
      inInterval,
      system,
      clusterRadius,
      minClusterSize
    );

    for (const cluster of clusters) {
      const nodeId = globalNodeId++;
      const cx =
        cluster.reduce((s, id) => s + system.posX[id], 0) / cluster.length;
      const cy =
        cluster.reduce((s, id) => s + system.posY[id], 0) / cluster.length;
      const cz =
        cluster.reduce((s, id) => s + system.posZ[id], 0) / cluster.length;
      const cw =
        cluster.reduce((s, id) => s + system.posW[id], 0) / cluster.length;
      const lensCenter = (lo + hi) / 2;

      nodes.push({
        id: nodeId,
        atoms: cluster,
        lensValue: lensCenter,
        clusterCenter: [cx, cy, cz, cw],
        label: `${lens}:${k}`,
      });

      for (const atomId of cluster) {
        let list = atomToNodes.get(atomId);
        if (!list) {
          list = [];
          atomToNodes.set(atomId, list);
        }
        list.push(nodeId);
      }
    }
  }

  // Build edges from atom memberships: any two nodes sharing an atom get an edge.
  const edgeMap = new Map<string, MapperEdge>(); // "a:b" → edge

  for (const [atomId, nodeIds] of atomToNodes) {
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const lo = Math.min(nodeIds[i], nodeIds[j]);
        const hi = Math.max(nodeIds[i], nodeIds[j]);
        const key = `${lo}:${hi}`;
        let edge = edgeMap.get(key);
        if (!edge) {
          edge = { nodeA: lo, nodeB: hi, commonAtoms: [], topoInterest: false };
          edgeMap.set(key, edge);
        }
        edge.commonAtoms.push(atomId);
      }
    }
  }

  const edges = [...edgeMap.values()];

  // Annotate edges using H₁ bars: flag edges that straddle a persistent loop.
  if (diagram.h1.length > 0) {
    const minPersistence = DOPAT_CONFIG.orbital.BASE_RADIUS * 0.1;
    const persistentH1Bars = diagram.h1.filter(
      bar => bar.death - bar.birth > minPersistence
    );

    const atomNodeSet = new Map<number, Set<number>>();
    for (const node of nodes) {
      for (const a of node.atoms) {
        let s = atomNodeSet.get(a);
        if (!s) {
          s = new Set();
          atomNodeSet.set(a, s);
        }
        s.add(node.id);
      }
    }

    for (const edge of edges) {
      for (const bar of persistentH1Bars) {
        const genId = bar.generatorAtomId;
        const nodeSet = atomNodeSet.get(genId);
        if (!nodeSet) continue;
        const inA = nodeSet.has(edge.nodeA);
        const inB = nodeSet.has(edge.nodeB);
        if (inA !== inB) {
          const d2Limit = bar.death * bar.death;
          const isSpatiallyClose = edge.commonAtoms.some(atomId => {
            const dx = system.posX[atomId] - system.posX[genId];
            const dy = system.posY[atomId] - system.posY[genId];
            const dz = system.posZ[atomId] - system.posZ[genId];
            const dw = system.posW[atomId] - system.posW[genId];
            return dx * dx + dy * dy + dz * dz + dw * dw <= d2Limit;
          });
          if (isSpatiallyClose) {
            edge.topoInterest = true;
            break;
          }
        }
      }
    }
  }

  return { nodes, edges, diagram };
}

// ─── lens functions ──────────────────────────────────────────────────────────

function lensValues(
  atoms: number[],
  system: Root.ManifoldView,
  lens: LensType
): number[] {
  return atoms.map(id => {
    switch (lens) {
      case "posX":
        return system.posX[id];
      case "mass":
        return Math.abs(system.mass[id]);
      case "density":
        return system.density[id];
      default:
        return 0;
    }
  });
}

// ─── single-linkage clustering ───────────────────────────────────────────────

function singleLinkage(
  atoms: number[],
  system: Root.ManifoldView,
  threshold: number,
  minSize: number
): number[][] {
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

  for (let i = 0; i < n; i++) {
    const ai = atoms[i];
    for (let j = i + 1; j < n; j++) {
      const aj = atoms[j];
      const dx = system.posX[ai] - system.posX[aj];
      const dy = system.posY[ai] - system.posY[aj];
      const dz = system.posZ[ai] - system.posZ[aj];
      const dw = system.posW[ai] - system.posW[aj];
      if (dx * dx + dy * dy + dz * dz + dw * dw <= threshold * threshold) {
        const ra = find(i);
        const rb = find(j);
        if (ra !== rb) parent[rb] = ra;
      }
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let g = groups.get(r);
    if (!g) {
      g = [];
      groups.set(r, g);
    }
    g.push(atoms[i]);
  }

  return [...groups.values()].filter(g => g.length >= minSize);
}

/**
 * Returns the TopologyMapper node IDs that a given atom participates in,
 * encoded as a comma-separated string.  Used as the vault topo_signature.
 */
export function atomTopoSignature(atomId: number, graph: NerveGraph): string {
  const nodeIds: number[] = [];
  for (const node of graph.nodes) {
    if (node.atoms.includes(atomId)) nodeIds.push(node.id);
  }
  return nodeIds.sort((a, b) => a - b).join(",");
}

/**
 * Jaccard similarity between two topo_signature strings.
 * Both are comma-separated node-ID lists.
 */
export function topoSignatureJaccard(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const sa = new Set(a.split(",").map(Number));
  const sb = new Set(b.split(",").map(Number));
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}
