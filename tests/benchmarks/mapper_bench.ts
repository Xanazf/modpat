/**
 * Mapper performance benchmark.
 * Run: tsx tests/benchmarks/mapper_bench.ts
 *
 * Measures ms/query across manifold sizes before and after each sub-track.
 * Acceptance targets (plan/track_03_mapper_performance.md):
 *   3a: ≥10× speedup at n=50k versus baseline
 *   3b: 4× fewer exp() calls per iteration (implicit in analytic gradient)
 */

import { DOPAT_CONFIG } from "@config";
import Mapper from "@core_i/Mapper";
import System from "@core_i/System";
import { random, seedRandom } from "@utils/seededRandom";

const CORPUS = [100, 1_000, 10_000, 50_000, 100_000, 1_000_000];
const QUERIES_PER_SIZE = 20;

function buildFixture(n: number): System {
  const system = new System();
  const ir = DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS;
  const spread = Math.sqrt(ir) * Math.sqrt(n) * 2;

  for (let i = 0; i < n; i++) {
    const id = system.createLocation(1.0 + random(), 1.0 + random());
    system.posX[id] = (random() - 0.5) * spread;
    system.posY[id] = (random() - 0.5) * spread;
    system.posZ[id] = (random() - 0.5) * spread;
    system.posW[id] = random() * spread * 0.01; // age increases slowly
    system.depth[id] = random();
    system.time[id] = random();
    system.update(id);
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
  (DOPAT_CONFIG as any).MAX_PRECEPTS = 1_100_000;
  seedRandom(DOPAT_CONFIG.SEED);
  console.log("Mapper benchmark, CPU path (no GPU)\n");
  console.log(
    `${"n".padStart(8)}  ${"ms/query".padStart(10)}  ${"queries".padStart(8)}`
  );
  console.log("".repeat(34));

  for (const n of CORPUS) {
    const system = buildFixture(n);
    const mapper = new Mapper(system);

    // Warm-up
    const [wa, wb] = randomQuery(system);
    await mapper.route(wa, wb, { steps: 16, maxIterations: 20 });

    const t0 = performance.now();
    for (let i = 0; i < QUERIES_PER_SIZE; i++) {
      const [a, b] = randomQuery(system);
      await mapper.route(a, b, { steps: 16, maxIterations: 20 });
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
