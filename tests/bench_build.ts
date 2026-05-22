import { DOPAT_CONFIG } from "../src/config";
import System from "../src/core/integral/System";
import Traveler from "../src/core/integral/Traveler";
import { seedRandom } from "../src/utils/seededRandom";

function buildFixture(n: number): System {
  const system = new System();
  const ir = DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS;
  const spread = Math.sqrt(ir) * Math.sqrt(n) * 2;

  for (let i = 0; i < n; i++) {
    const id = system.createLocation(1.0 + Math.random(), 1.0 + Math.random());
    system.posX[id] = (Math.random() - 0.5) * spread;
    system.posY[id] = (Math.random() - 0.5) * spread;
    system.posZ[id] = (Math.random() - 0.5) * spread;
    system.posW[id] = Math.random() * spread * 0.01;
    system.depth[id] = Math.random();
    system.time[id] = Math.random();
    system.update(id);
  }
  return system;
}

async function run() {
  (DOPAT_CONFIG as any).MAX_PRECEPTS = 1_100_000;
  seedRandom(DOPAT_CONFIG.SEED);

  console.log("Building system of 1,000,000 atoms...");
  const system = buildFixture(1_000_000);

  const traveler = new Traveler(system);

  console.log("Running a single traveler.route call...");
  const t0 = performance.now();
  const sourceId = 50000;
  const targetId = 60000;
  await traveler.route(sourceId, targetId, { steps: 16, maxIterations: 20 });
  console.log(
    `Single traveler.route took ${(performance.now() - t0).toFixed(1)}ms`
  );

  console.log("Running 20 traveler.route calls...");
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) {
    const a = Math.floor(Math.random() * 1000000);
    const b = Math.floor(Math.random() * 1000000);
    const t_start = performance.now();
    await traveler.route(a, b, { steps: 16, maxIterations: 20 });
    console.log(
      `  Query ${i} took ${(performance.now() - t_start).toFixed(1)}ms`
    );
  }
  const ms = (performance.now() - t1) / 20;
  console.log(`Average traveler.route took ${ms.toFixed(1)}ms`);
}

run();
