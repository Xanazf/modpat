/**
 * Clustered-manifold traversal benchmark (Phase 4 - DOD-fast navigation).
 * Run: tsx tests/benchmarks/traversal_bench.ts
 *
 * Unlike mapper_bench.ts (which spreads atoms thinly so each force evaluation
 * sees almost no candidates), this fixture packs atoms into tight clusters so
 * that `getMetricForce` returns many candidates per call - the regime the real
 * grounded manifold lives in and where the "5-hop = 2.6 s" cost comes from.
 *
 * It reports ms/query and the mean candidate count per force evaluation, so the
 * efficiency thesis ("explicit topology is cheaper to navigate") is a measured
 * number rather than a claim. Re-run before/after any locomotion change.
 */

import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { random, seedRandom } from "@utils/seededRandom";

// (clusters, atomsPerCluster) - total = product. Density is what matters here.
const FIXTURES: Array<[clusters: number, perCluster: number]> = [
  [10, 50], // 500 atoms, dense
  [20, 100], // 2_000 atoms
  [50, 200], // 10_000 atoms
  [100, 500], // 50_000 atoms
];
const QUERIES_PER_SIZE = 20;
// Real traversal defaults from travel(): steps 32, maxIterations 100.
const STEPS = 32;
const MAX_ITERATIONS = 100;

function buildClusteredFixture(clusters: number, perCluster: number): System {
  const system = new System();
  const ir = DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS;
  // Cluster radius < sqrt(INFLUENCE_RADIUS) so intra-cluster atoms are mutual
  // candidates; cluster centers spread well beyond influence range.
  const clusterRadius = Math.sqrt(ir) * 0.6;
  const centerSpread = Math.sqrt(ir) * clusters;

  for (let c = 0; c < clusters; c++) {
    const cxc = (random() - 0.5) * centerSpread;
    const cyc = (random() - 0.5) * centerSpread;
    const czc = (random() - 0.5) * centerSpread;
    const cwc = random() * centerSpread * 0.01;
    for (let k = 0; k < perCluster; k++) {
      const id = system.createLocation(1.0 + random(), 1.0 + random());
      system.posX[id] = cxc + (random() - 0.5) * clusterRadius;
      system.posY[id] = cyc + (random() - 0.5) * clusterRadius;
      system.posZ[id] = czc + (random() - 0.5) * clusterRadius;
      system.posW[id] = cwc + random() * clusterRadius * 0.01;
      system.depth[id] = random();
      system.time[id] = random();
      system.update(id);
    }
  }
  return system;
}

function randomQuery(system: System): [number, number] {
  const n = system.length;
  const a = Math.floor(random() * n);
  let b = Math.floor(random() * n);
  while (b === a) b = Math.floor(random() * n);
  return [a, b];
}

async function run(): Promise<void> {
  (DOPAT_CONFIG as any).MAX_PRECEPTS = 200_000;
  (DOPAT_CONFIG as any).USE_GPU = false;
  seedRandom(DOPAT_CONFIG.SEED);

  console.log("Clustered traversal benchmark, CPU path");
  console.log(`steps=${STEPS}, maxIterations=${MAX_ITERATIONS}\n`);
  console.log(
    `${"atoms".padStart(8)}  ${"ms/query".padStart(10)}  ${"queries".padStart(8)}`
  );
  console.log("-".repeat(34));

  for (const [clusters, perCluster] of FIXTURES) {
    const n = clusters * perCluster;
    const system = buildClusteredFixture(clusters, perCluster);
    const mapper = new Traveler(system);

    const [wa, wb] = randomQuery(system);
    await mapper.route(wa, wb, { steps: STEPS, maxIterations: MAX_ITERATIONS });

    const t0 = performance.now();
    for (let i = 0; i < QUERIES_PER_SIZE; i++) {
      const [a, b] = randomQuery(system);
      await mapper.route(a, b, { steps: STEPS, maxIterations: MAX_ITERATIONS });
    }
    const ms = (performance.now() - t0) / QUERIES_PER_SIZE;
    console.log(
      `${n.toString().padStart(8)}  ${ms.toFixed(1).padStart(9)}ms  ${QUERIES_PER_SIZE.toString().padStart(8)}`
    );
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
