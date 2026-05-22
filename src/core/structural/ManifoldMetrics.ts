/**
 * ManifoldMetrics - distance toolkit and orbital observatory for the 4D manifold.
 *
 * Now that scope is a pure identity tag (no band arithmetic), semantic proximity
 * lives entirely in 4D position space (posX/Y/Z/W).  This module provides:
 *
 *   distance4D     - Euclidean distance between two atoms in 4D space
 *   orbitRadius    - gravitational zone of influence for an atom
 *   orbitalParent  - the dominant attractor this atom is drawn toward
 *   satellites     - atoms currently within this atom's zone of influence
 *   constellations - connected orbital clusters across the manifold
 *
 * The two emergent observables per atom:
 *   • "I'm in another atom's orbit"  → orbitalParent(id) !== null
 *   • "I have other atoms in my orbit" → satellites(id).length > 0
 */

import { DOPAT_CONFIG } from "@config";
import { GridIndex4D } from "@mutate/GridIndex4D";

// Core geometry

/** Euclidean distance between two atoms in the 4D (Matter×Kind×Energy×Age) manifold. */
export function distance4D(
  id1: number,
  id2: number,
  system: Root.ManifoldView
): number {
  const dx = system.posX[id1] - system.posX[id2];
  const dy = system.posY[id1] - system.posY[id2];
  const dz = system.posZ[id1] - system.posZ[id2];
  const dw = system.posW[id1] - system.posW[id2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
}

/**
 * Gravitational zone of influence for an atom.
 *
 * Formula: BASE_RADIUS × √(|mass| / (c² + |mass|))
 *
 * This is bounded: radius → 0 for massless atoms, radius → BASE_RADIUS as
 * mass → ∞.  Massive operators (mass ≈ c²) have radius ≈ BASE_RADIUS/√2.
 * Ordinary semantic atoms (mass ≈ c) have radius ≈ BASE_RADIUS/√(1+c).
 */
export function orbitRadius(id: number, system: Root.ManifoldView): number {
  const m = Math.abs(system.mass[id]);
  if (m === 0) return 0;
  const c2 = system.c * system.c;
  return DOPAT_CONFIG.orbital.BASE_RADIUS * Math.sqrt(m / (c2 + m));
}

// Emergent observables

/**
 * Returns the ID of the dominant attractor this atom is gravitationally bound to,
 * or null if the atom is not within any other atom's zone of influence.
 *
 * "I'm in another atom's orbit."
 *
 * The parent is the nearest atom that:
 *   1. Has strictly greater mass than self (it is the attractor, not the satellite)
 *   2. Has self within its orbitRadius
 *
 * When multiple attractors qualify, the one with the largest mass wins - the
 * deepest gravitational well dominates.
 */
export function orbitalParent(
  id: number,
  system: Root.ManifoldView,
  index?: GridIndex4D
): number | null {
  const minParentMass = system.c * DOPAT_CONFIG.orbital.MIN_PARENT_MASS_RATIO;
  const selfMass = Math.abs(system.mass[id]);
  const searchRadius = DOPAT_CONFIG.orbital.BASE_RADIUS;

  let bestParent: number | null = null;
  let bestMass = selfMass; // only consider atoms strictly heavier

  const candidates = index
    ? index.candidatesInRadius(
        system.posX[id],
        system.posY[id],
        system.posZ[id],
        system.posW[id],
        searchRadius
      )
    : _allAllocated(system);

  for (const cId of candidates) {
    if (cId === id || !system.isAllocated(cId)) continue;
    const cMass = Math.abs(system.mass[cId]);
    if (cMass <= bestMass || cMass < minParentMass) continue;

    const r = orbitRadius(cId, system);
    if (r === 0) continue;
    if (distance4D(id, cId, system) < r) {
      bestMass = cMass;
      bestParent = cId;
    }
  }

  return bestParent;
}

/**
 * Returns the IDs of all atoms currently within this atom's zone of influence.
 *
 * "I have other atoms in my orbit."
 *
 * A satellite must have strictly less mass than the central atom.
 */
export function satellites(
  id: number,
  system: Root.ManifoldView,
  index?: GridIndex4D
): number[] {
  const r = orbitRadius(id, system);
  if (r === 0) return [];

  const selfMass = Math.abs(system.mass[id]);
  const result: number[] = [];

  const candidates = index
    ? index.candidatesInRadius(
        system.posX[id],
        system.posY[id],
        system.posZ[id],
        system.posW[id],
        r
      )
    : _allAllocated(system);

  for (const cId of candidates) {
    if (cId === id || !system.isAllocated(cId)) continue;
    if (Math.abs(system.mass[cId]) >= selfMass) continue;
    if (distance4D(id, cId, system) < r) {
      result.push(cId);
    }
  }

  return result;
}

// Constellation detection

export interface Constellation {
  /** Sequential identifier within the current snapshot. */
  id: number;
  /** ID of the most massive member - the gravitational centre ("star"). */
  star: number;
  /** All member atom IDs, including the star. */
  members: number[];
  /** Total mass of all members. */
  totalMass: number;
}

/**
 * Detects all orbital clusters (constellations) across the manifold.
 *
 * Two atoms are connected when either lies within the other's orbitRadius.
 * Connected components of this undirected graph are the constellations.
 *
 * Runs in O(N·k) where k is the average neighbourhood size under the spatial
 * index; without the index it falls back to O(N²).
 *
 * @param minSize   Minimum member count to include in the result (default 2).
 */
export function constellations(
  system: Root.ManifoldView,
  opts: { minSize?: number; index?: GridIndex4D } = {}
): Constellation[] {
  const { minSize = 2, index } = opts;
  const n = system.length;
  const parent = new Int32Array(n).fill(-1);

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path compression
      x = parent[x];
    }
    return x;
  }
  function union(a: number, b: number): void {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  }

  // Initialise union-find for allocated atoms only
  const allocated: number[] = [];
  for (let i = 0; i < n; i++) {
    if (system.isAllocated(i)) {
      parent[i] = i;
      allocated.push(i);
    }
  }

  // Build orbital adjacency
  for (const id of allocated) {
    const r = orbitRadius(id, system);
    if (r === 0) continue;
    const selfMass = Math.abs(system.mass[id]);

    const candidates = index
      ? index.candidatesInRadius(
          system.posX[id],
          system.posY[id],
          system.posZ[id],
          system.posW[id],
          r
        )
      : allocated;

    for (const cId of candidates) {
      if (cId <= id || !system.isAllocated(cId)) continue; // undirected: process each pair once
      const cMass = Math.abs(system.mass[cId]);
      // Link when either is within the other's orbit
      const rC = orbitRadius(cId, system);
      const dist = distance4D(id, cId, system);
      if (dist < r || dist < rC) {
        union(id, cId);
      }
    }
  }

  // Collect components
  const groups = new Map<number, number[]>();
  for (const id of allocated) {
    const root = find(id);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    g.push(id);
  }

  const result: Constellation[] = [];
  let seqId = 0;
  for (const members of groups.values()) {
    if (members.length < minSize) continue;
    let star = members[0];
    let totalMass = 0;
    for (const id of members) {
      totalMass += Math.abs(system.mass[id]);
      if (Math.abs(system.mass[id]) > Math.abs(system.mass[star])) star = id;
    }
    result.push({ id: seqId++, star, members, totalMass });
  }

  // Sort by total mass descending (largest constellations first)
  result.sort((a, b) => b.totalMass - a.totalMass);
  return result;
}

// Constellation gap detection

export interface ConstellationGap {
  constellation: Constellation;
  atomA: number;
  atomB: number;
  labelA: string;
  labelB: string;
  /** 4D distance between the two atoms. */
  distance: number;
  /**
   * Gap score = distance / combinedOrbitRadius × combinedMass.
   * High score = heavy atoms that are barely inside each other's orbit -
   * the most "strained" connection in the constellation, most likely to
   * represent a missing inferential bridge.
   */
  gapScore: number;
}

/**
 * Identifies the most strained atom pairs within each constellation - pairs
 * that are orbitally bound but barely overlapping, suggesting their gravitational
 * link has no direct inferential support.  These are the natural investigation
 * targets for curiosity-driven inquiry.
 *
 * Strategy: within each constellation, find pairs where
 *   distance / (orbitRadius_A + orbitRadius_B) is highest
 * i.e. they're at the outer edge of each other's influence.  High combined
 * mass amplifies the score (heavier atoms = more important gap to bridge).
 */
export function constellationGaps(
  system: Root.ManifoldView,
  consts: Constellation[],
  atomizer: Atomic.Engine,
  opts: { maxPerConstellation?: number; minMassRatio?: number } = {}
): ConstellationGap[] {
  const { maxPerConstellation = 2, minMassRatio = 0.1 } = opts;
  const minMass = system.c * minMassRatio;
  const gaps: ConstellationGap[] = [];

  for (const c of consts) {
    if (c.members.length < 3) continue;

    const heavy = c.members.filter(
      id => system.isAllocated(id) && Math.abs(system.mass[id]) >= minMass
    );
    if (heavy.length < 2) continue;

    const pairGaps: { a: number; b: number; dist: number; score: number }[] =
      [];

    for (let i = 0; i < heavy.length; i++) {
      for (let j = i + 1; j < heavy.length; j++) {
        const a = heavy[i],
          b = heavy[j];
        const dist = distance4D(a, b, system);
        const rA = orbitRadius(a, system);
        const rB = orbitRadius(b, system);
        const combined = rA + rB;
        if (combined === 0) continue;
        const tension = dist / combined; // > 1 = outside mutual influence
        const mass = Math.abs(system.mass[a]) + Math.abs(system.mass[b]);
        pairGaps.push({ a, b, dist, score: tension * mass });
      }
    }

    pairGaps.sort((x, y) => y.score - x.score);

    for (const { a, b, dist, score } of pairGaps.slice(
      0,
      maxPerConstellation
    )) {
      const labelA = atomizer.resolveScope(system.scope[a]);
      const labelB = atomizer.resolveScope(system.scope[b]);
      if (!labelA || !labelB) continue;
      gaps.push({
        constellation: c,
        atomA: a,
        atomB: b,
        labelA,
        labelB,
        distance: dist,
        gapScore: score,
      });
    }
  }

  return gaps.sort((a, b) => b.gapScore - a.gapScore);
}

/**
 * Builds a spatial index over all allocated atoms for fast radius queries.
 * Reuse this across multiple orbitalParent / satellites / constellations calls
 * within a single snapshot to avoid rebuilding the index repeatedly.
 */
export function buildManifoldIndex(system: Root.ManifoldView): GridIndex4D {
  const cellSize = Math.max(DOPAT_CONFIG.orbital.BASE_RADIUS * 0.5, 1);
  const index = new GridIndex4D(cellSize);
  for (let i = 0; i < system.length; i++) {
    if (system.isAllocated(i)) {
      index.insert(
        i,
        system.posX[i],
        system.posY[i],
        system.posZ[i],
        system.posW[i]
      );
    }
  }
  return index;
}

/** Fallback: iterate all allocated IDs when no spatial index is provided. */
function _allAllocated(system: Root.ManifoldView): number[] {
  const out: number[] = [];
  for (let i = 0; i < system.length; i++) {
    if (system.isAllocated(i)) out.push(i);
  }
  return out;
}
