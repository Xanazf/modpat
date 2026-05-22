import type { ClusterId } from "./FrameworkIndex";

// ─── public interfaces ────────────────────────────────────────────────────────

export interface SessionOverlap {
  sessionA: string;
  sessionB: string;
  sharedClusterIds: Set<ClusterId>;
  /** Semantic divergence per shared cluster; length === sharedClusterIds.size. */
  restrictionDifference: Float64Array;
}

export interface SessionSheaf {
  overlaps: SessionOverlap[];
  /** H¹ Betti number of the session nerve complex (0 = globally consistent). */
  h1Betti: number;
  /** Cluster IDs appearing in contradictory (non-bounding) 1-cycles. */
  conflictingClusters: Set<ClusterId>;
}

/**
 * Compute the Čech cohomology of the session cover.
 *
 * Each session is a 0-simplex; two sessions form a 1-simplex when they share
 * at least one cluster.  A triple of mutually-overlapping sessions forms a
 * 2-simplex.  The H¹ Betti number counts 1-cycles that are not boundaries of
 * 2-simplices - each such cycle represents a global semantic conflict that no
 * local context assignment can resolve.
 *
 * @param activations  sessionId → Set of ClusterIds activated in that session.
 * @param sessionClusterPhi  Optional map from sessionId → (ClusterId → φ value),
 *   used to populate restrictionDifference.  If absent, differences default to 0.
 */
export function computeSessionSheaf(
  activations: Map<string, Set<ClusterId>>,
  sessionClusterPhi?: Map<string, Map<ClusterId, number>>
): SessionSheaf {
  const sessions = [...activations.keys()];
  const n = sessions.length;

  if (n === 0) {
    return { overlaps: [], h1Betti: 0, conflictingClusters: new Set() };
  }

  // ── Build overlaps (1-simplices) ──────────────────────────────────────────
  const overlaps: SessionOverlap[] = [];
  // edgeIndex[i][j] (i < j) = index into overlaps array
  const edgeIdx = new Map<number, number>(); // packed key i*n+j → overlap index

  for (let i = 0; i < n; i++) {
    const setI = activations.get(sessions[i])!;
    for (let j = i + 1; j < n; j++) {
      const setJ = activations.get(sessions[j])!;
      const shared = new Set<ClusterId>();
      for (const c of setI) {
        if (setJ.has(c)) shared.add(c);
      }
      if (shared.size === 0) continue;

      // Restriction difference: |φ_A(c) − φ_B(c)| per shared cluster
      // (zero when no phi data is provided).
      const diff = new Float64Array(shared.size);
      if (sessionClusterPhi) {
        let k = 0;
        const phiAValues = sessionClusterPhi.get(sessions[i]);
        const phiBValues = sessionClusterPhi.get(sessions[j]);
        for (const c of shared) {
          const phiA = phiAValues?.get(c) ?? 0;
          const phiB = phiBValues?.get(c) ?? 0;
          diff[k++] = Math.abs(phiA - phiB);
        }
      }

      const idx = overlaps.length;
      overlaps.push({
        sessionA: sessions[i],
        sessionB: sessions[j],
        sharedClusterIds: shared,
        restrictionDifference: diff,
      });
      edgeIdx.set(i * n + j, idx);
    }
  }

  const numEdges = overlaps.length;
  if (numEdges === 0) {
    return { overlaps, h1Betti: 0, conflictingClusters: new Set() };
  }

  // ── Find triangles (2-simplices): i < j < k with non-empty TRIPLE intersection ──
  // Čech cohomology requires A∩B∩C ≠ ∅ for a 2-simplex, not just pairwise overlaps.
  interface Triangle {
    i: number;
    j: number;
    k: number;
    eIJ: number; // edge index for (i,j)
    eIK: number;
    eJK: number;
  }
  const triangles: Triangle[] = [];
  for (let i = 0; i < n; i++) {
    const setI = activations.get(sessions[i])!;
    for (let j = i + 1; j < n; j++) {
      const eIJ = edgeIdx.get(i * n + j);
      if (eIJ === undefined) continue;
      const setJ = activations.get(sessions[j])!;
      for (let k = j + 1; k < n; k++) {
        const eIK = edgeIdx.get(i * n + k);
        const eJK = edgeIdx.get(j * n + k);
        if (eIK === undefined || eJK === undefined) continue;
        // Čech criterion: check that i∩j∩k ≠ ∅
        const setK = activations.get(sessions[k])!;
        let hasTriple = false;
        for (const c of setI) {
          if (setJ.has(c) && setK.has(c)) {
            hasTriple = true;
            break;
          }
        }
        if (hasTriple) {
          triangles.push({ i, j, k, eIJ, eIK, eJK });
        }
      }
    }
  }

  // ── H¹ Betti number via Euler characteristic ─────────────────────────────
  // β₀ = number of connected components in the overlap graph.
  // β₁ = numEdges − numSessions + β₀ − rank(∂₂)
  //
  // rank(∂₂) = number of linearly independent triangles over GF(2).
  // We compute this via column reduction of the boundary matrix ∂₂
  // (rows = edges, columns = triangles).

  const beta0 = connectedComponents(n, overlaps, sessions);

  // GF(2) column reduction of ∂₂.
  // pivotFor[r] = triangle index whose reduced column has lowest row r.
  const pivotFor = new Map<number, number>();
  let rankB2 = 0;

  for (let t = 0; t < triangles.length; t++) {
    const tri = triangles[t];
    // Boundary = {eIJ, eIK, eJK} (sorted ascending)
    let col = [tri.eIJ, tri.eIK, tri.eJK].sort((a, b) => a - b);

    while (col.length > 0) {
      const low = col[col.length - 1];
      const prev = pivotFor.get(low);
      if (prev === undefined) break;
      // XOR col with the pivot column for `low`
      col = xorSorted(col, pivotTriangle(triangles[prev]));
    }

    if (col.length > 0) {
      pivotFor.set(col[col.length - 1], t);
      rankB2++;
    }
  }

  const h1Betti = Math.max(0, numEdges - n + beta0 - rankB2);

  // ── Conflicting clusters: shared clusters in non-bounding edges ───────────
  const conflictingClusters = new Set<ClusterId>();
  if (h1Betti > 0) {
    // Unpaired edges (those not eliminated by pivot) participate in non-bounding cycles.
    const usedAsLow = new Set(pivotFor.keys());
    for (let ei = 0; ei < overlaps.length; ei++) {
      if (!usedAsLow.has(ei)) {
        for (const c of overlaps[ei].sharedClusterIds) {
          conflictingClusters.add(c);
        }
      }
    }
  }

  return { overlaps, h1Betti, conflictingClusters };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function connectedComponents(
  n: number,
  overlaps: SessionOverlap[],
  sessions: string[]
): number {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }

  for (const ov of overlaps) {
    const i = sessions.indexOf(ov.sessionA);
    const j = sessions.indexOf(ov.sessionB);
    const ri = find(i);
    const rj = find(j);
    if (ri !== rj) parent[rj] = ri;
  }

  const roots = new Set<number>();
  for (let i = 0; i < n; i++) roots.add(find(i));
  return roots.size;
}

function pivotTriangle(tri: {
  eIJ: number;
  eIK: number;
  eJK: number;
}): number[] {
  return [tri.eIJ, tri.eIK, tri.eJK].sort((a, b) => a - b);
}

function xorSorted(a: number[], b: number[]): number[] {
  const result: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] < b[j]) {
      result.push(a[i++]);
    } else if (a[i] > b[j]) {
      result.push(b[j++]);
    } else {
      i++;
      j++;
    }
  }
  while (i < a.length) result.push(a[i++]);
  while (j < b.length) result.push(b[j++]);
  return result;
}
