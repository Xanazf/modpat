/**
 * Prototype: is d3-hexadectree a better candidate-search structure than the
 * existing GridIndex4D for the manifold's radius queries?
 * Run: tsx scripts/dev/hexadectree_radius_proto.ts
 *
 * The metric force is a Gaussian kernel with a HARD radius cutoff (d² ≥
 * INFLUENCE_RADIUS ⇒ skip), so Barnes-Hut multipole approximation buys little
 * (far bodies already contribute exactly zero; near bodies can't be lumped as a
 * far multipole). The honest question is therefore whether the hexadectree's
 * density-adaptive radius query beats the uniform grid - on a CLUSTERED
 * manifold the grid's dense cells degrade to big-bucket scans, whereas the tree
 * subdivides. We measure (a) result-set parity (must be identical) and (b) wall
 * time for N queries at the production radius. sqrt(INFLUENCE_RADIUS) because
 * the grid stores radius² while the tree's findAllWithinRadius takes a radius.
 */

import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import { DOPAT_CONFIG } from "@config";
import { hexadectree } from "d3-hexadectree";

function makeClusteredPoints(n: number, clusters: number, seed = 1) {
  // deterministic LCG so runs are comparable
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const cx: number[] = [],
    cy: number[] = [],
    cz: number[] = [],
    cw: number[] = [];
  for (let c = 0; c < clusters; c++) {
    cx.push(rnd() * 1000);
    cy.push(rnd() * 1000);
    cz.push(rnd() * 200 - 100);
    cw.push(rnd() * 100);
  }
  const pts: { id: number; x: number; y: number; z: number; w: number }[] = [];
  for (let i = 0; i < n; i++) {
    const c = Math.floor(rnd() * clusters);
    pts.push({
      id: i,
      x: cx[c] + (rnd() - 0.5) * 30,
      y: cy[c] + (rnd() - 0.5) * 30,
      z: cz[c] + (rnd() - 0.5) * 10,
      w: cw[c] + (rnd() - 0.5) * 10,
    });
  }
  return pts;
}

function main(): void {
  // Production passes a LINEAR radius = sqrt(INFLUENCE_RADIUS) to the grid (the
  // kernel cutoff is d² < INFLUENCE_RADIUS). The grid is a coarse cell prefilter;
  // forceFromCandidates then drops candidates with d² ≥ INFLUENCE_RADIUS.
  const radius2 = DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS as number; // d² cutoff
  const radius = Math.sqrt(radius2); // linear radius actually queried
  const N = 20000;
  const QUERIES = 5000;
  const pts = makeClusteredPoints(N, 24);

  // --- build both indexes ---
  const grid = new GridIndex4D();
  for (const p of pts) grid.insert(p.id, p.x, p.y, p.z, p.w);

  const tree = hexadectree(
    pts,
    (d: any) => d.x,
    (d: any) => d.y,
    (d: any) => d.z,
    (d: any) => d.w
  );

  // query points: same cluster centers as the data (seed 1) so queries land
  // inside dense zones, exercising the in-radius path that production hits.
  const qs = makeClusteredPoints(QUERIES, 24, 1);

  // --- parity check on a sample ---
  let mismatches = 0;
  const scratch: number[] = [];
  for (let i = 0; i < Math.min(200, qs.length); i++) {
    const q = qs[i];
    const n = grid.candidatesInRadiusInto(q.x, q.y, q.z, q.w, radius, scratch);
    const gridSet = new Set(scratch.slice(0, n));
    const treeRes = (tree as any).findAllWithinRadius(
      q.x,
      q.y,
      q.z,
      q.w,
      radius
    );
    const treeSet = new Set(treeRes.map((d: any) => d.id));
    // grid is a coarse cell filter (may return d² beyond radius); restrict to
    // the true in-radius set for an apples-to-apples comparison.
    const gridTrue = new Set<number>();
    for (const id of gridSet) {
      const p = pts[id];
      const dx = p.x - q.x,
        dy = p.y - q.y,
        dz = p.z - q.z,
        dw = p.w - q.w;
      if (dx * dx + dy * dy + dz * dz + dw * dw <= radius2) gridTrue.add(id);
    }
    if (gridTrue.size !== treeSet.size) mismatches++;
    else
      for (const id of treeSet)
        if (!gridTrue.has(id as number)) {
          mismatches++;
          break;
        }
  }

  // --- timing: grid ---
  let gridTotal = 0;
  let t0 = performance.now();
  for (const q of qs)
    gridTotal += grid.candidatesInRadiusInto(
      q.x,
      q.y,
      q.z,
      q.w,
      radius,
      scratch
    );
  const gridMs = performance.now() - t0;

  // --- timing: hexadectree ---
  let treeTotal = 0;
  t0 = performance.now();
  for (const q of qs)
    treeTotal += (tree as any).findAllWithinRadius(
      q.x,
      q.y,
      q.z,
      q.w,
      radius
    ).length;
  const treeMs = performance.now() - t0;

  console.log(
    `\nRadius-query structures (N=${N}, ${QUERIES} queries, r=${radius.toFixed(1)})\n`
  );
  console.log(`  parity mismatches (of 200 sampled): ${mismatches}`);
  console.log(
    `  grid (cell filter)  : ${gridMs.toFixed(1)} ms, ${(gridTotal / QUERIES).toFixed(1)} cand/query (pre-filter)`
  );
  console.log(
    `  hexadectree (exact) : ${treeMs.toFixed(1)} ms, ${(treeTotal / QUERIES).toFixed(1)} cand/query (in-radius)`
  );
  console.log(`  speed ratio grid/tree: ${(gridMs / treeMs).toFixed(2)}×\n`);
}

main();
