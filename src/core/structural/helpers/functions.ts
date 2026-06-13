import { distance4DPoints } from "@_lib/math/TensorMath";
import { NodeKind } from "./enums";

/** posY value per kind. Code kinds reuse astExtract's hints (0.0..0.9). */
const KIND_Y: Record<NodeKind, number> = {
  [NodeKind.Type]: 0.0,
  [NodeKind.Class]: 0.1,
  [NodeKind.Function]: 0.3,
  [NodeKind.Variable]: 0.6,
  [NodeKind.Enum]: 0.8,
  [NodeKind.Module]: 0.9,
  [NodeKind.Literal]: 0.5,
  [NodeKind.Operator]: 0.7,
  [NodeKind.Term]: 0.4,
};

const ALL_KINDS: NodeKind[] = [
  NodeKind.Type,
  NodeKind.Class,
  NodeKind.Function,
  NodeKind.Variable,
  NodeKind.Enum,
  NodeKind.Module,
  NodeKind.Literal,
  NodeKind.Operator,
  NodeKind.Term,
];

export function kindToY(k: NodeKind): number {
  return KIND_Y[k] ?? KIND_Y[NodeKind.Term];
}

/** Maps a posY hint (e.g. astExtract.kindY) back to the nearest NodeKind. */
export function yToKind(y: number): NodeKind {
  let best = NodeKind.Term;
  let bestD = Number.POSITIVE_INFINITY;
  for (const k of ALL_KINDS) {
    const d = Math.abs(KIND_Y[k] - y);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** Parses a bare numeric literal label; returns null for non-numeric labels. */
export function parseNumericLabel(label: string): number | null {
  return /^-?\d+(?:\.\d+)?$/.test(label.trim()) ? parseFloat(label) : null;
}

/** Euclidean distance between two atoms in the 4D (Matter×Kind×Energy×Age) manifold. */
export function distance4D(
  id1: number,
  id2: number,
  system: Root.ManifoldView
): number {
  return distance4DPoints(
    system.posX[id1],
    system.posY[id1],
    system.posZ[id1],
    system.posW[id1],
    system.posX[id2],
    system.posY[id2],
    system.posZ[id2],
    system.posW[id2]
  );
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
