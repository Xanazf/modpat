/**
 * Diagnostic: does the geometry self-correction (C3 Ricci flow) move the
 * manifold TOWARD or AWAY from faithfulness?
 * Run: tsx scripts/dev/faithfulness_dynamics_diag.ts
 *
 * C3 reshapes density/mass by -lr·clamp(R) (it does not move atoms), so it
 * cannot change MapFidelity (position-based) but it does change the metric and
 * hence the geodesics - its faithfulness objective is TraversalFidelity. This
 * harness grounds a faithful map, then runs the exact Ricci update repeatedly,
 * tracking traversal onPath/monotonicity and mean |R| so we can see whether the
 * dynamics are self-correction toward faithfulness or drift away from it.
 */

import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { computeCurvature } from "@props/Curvature";
import { extractAstTriples } from "@utils/astExtract";
import { seedRandom } from "@utils/seededRandom";

const SAMPLE_SOURCE = `
interface Result { code: number; message: string; }
interface Config { retries: number; }
class Engine {
  cfg: Config;
  start(): Result { return this.boot(); }
  boot(): Result { return this.validate(); }
  validate(): Result { return { code: 0, message: "ok" }; }
}
class Logger {
  write(line: string): void {}
  flush(): void { this.write("flush"); }
}
function bootstrap(engine: Engine, log: Logger): Result {
  log.write("starting");
  const r = engine.start();
  log.flush();
  return r;
}
function shutdown(engine: Engine): void { engine.validate(); }
`;

// Exact mirror of ManifoldLifecycle.runRicciFlowTick (one step).
function ricciStep(sys: System): void {
  const phys = DOPAT_CONFIG.PHYSICS;
  const thresh = phys.RICCI_BLOWUP_THRESHOLD;
  const lr = phys.RICCI_LR;
  const grid = new GridIndex4D(Math.max(Math.sqrt(phys.INFLUENCE_RADIUS), 0.5));
  grid.buildFromSystem(sys);
  for (let i = 0; i < sys.length; i++) {
    if (!sys.isAllocated(i)) continue;
    const { R } = computeCurvature(
      sys,
      grid,
      sys.posX[i],
      sys.posY[i],
      sys.posZ[i],
      sys.posW[i]
    );
    const Rc = Math.max(-thresh, Math.min(thresh, R));
    if (Rc === 0) continue;
    const delta = -lr * Rc;
    sys.density[i] = Math.max(0, sys.density[i] + delta);
    sys.mass[i] += delta;
    sys.update(i);
  }
}

function curvatureSummary(sys: System): { meanAbsR: number; meanPhi: number } {
  const grid = new GridIndex4D(
    Math.max(Math.sqrt(DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS), 0.5)
  );
  grid.buildFromSystem(sys);
  let sumR = 0;
  let sumPhi = 0;
  let n = 0;
  for (let i = 0; i < sys.length; i++) {
    if (!sys.isAllocated(i)) continue;
    const c = computeCurvature(
      sys,
      grid,
      sys.posX[i],
      sys.posY[i],
      sys.posZ[i],
      sys.posW[i]
    );
    sumR += Math.abs(c.R);
    sumPhi += c.phi;
    n++;
  }
  return { meanAbsR: n ? sumR / n : 0, meanPhi: n ? sumPhi / n : 0 };
}

async function main(): Promise<void> {
  (DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;
  seedRandom(0);
  const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
    includeCallSites: true,
  });
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const { graph, nodeToPrecept } = groundAstIntoSystem(
    triples,
    system,
    atomizer,
    { seed: 0 }
  );
  const traveler = new Traveler(system);

  const measure = async () => {
    const f = await traversalFidelity(
      graph,
      nodeToPrecept,
      (s, t) => traveler.traverse(s, t),
      { maxPairs: 40 }
    );
    return { onPath: f.onPathRate, mono: f.monotonicity, reach: f.reachRate };
  };

  const phys = DOPAT_CONFIG.PHYSICS as { CONFORMAL_ENABLED: boolean };

  // (1) φ saturation: is the conformal factor e^{-2φ} effectively zero?
  const cs = curvatureSummary(system);
  console.log(
    `\nφ saturation: meanφ=${cs.meanPhi.toFixed(2)} (PHI_MAX=${DOPAT_CONFIG.PHYSICS.PHI_MAX}), ` +
      `e^{-2φ}≈${Math.exp(-2 * cs.meanPhi).toExponential(2)}, mean|R|=${cs.meanAbsR.toFixed(4)}`
  );

  // (2) Does the conformal metric force help or hurt faithfulness? Compare the
  // geodesic's structure-tracking with the conformal factor on vs off.
  const conformalOn = phys.CONFORMAL_ENABLED;
  phys.CONFORMAL_ENABLED = true;
  const fOn = await measure();
  phys.CONFORMAL_ENABLED = false;
  const fOff = await measure();
  phys.CONFORMAL_ENABLED = conformalOn;
  console.log(
    `\nmetric-force role (traversal fidelity):\n` +
      `  conformal ON  (current): onPath=${fOn.onPath.toFixed(3)} monotonic=${fOn.mono.toFixed(3)} reach=${fOn.reach.toFixed(2)}\n` +
      `  conformal OFF          : onPath=${fOff.onPath.toFixed(3)} monotonic=${fOff.mono.toFixed(3)} reach=${fOff.reach.toFixed(2)}`
  );

  // (3) C3 Ricci flow trajectory: does running it move fidelity?
  console.log("\nC3 Ricci flow vs. traversal faithfulness\n");
  console.log(
    `${"ricciSteps".padStart(10)}  ${"mean|R|".padStart(9)}  ${"onPath".padStart(7)}  ${"monotonic".padStart(9)}  ${"reach".padStart(6)}`
  );
  const STEP_GROUP = 25;
  const GROUPS = 8;
  for (let g = 0; g <= GROUPS; g++) {
    if (g > 0) for (let s = 0; s < STEP_GROUP; s++) ricciStep(system);
    const r = await measure();
    console.log(
      `${(g * STEP_GROUP).toString().padStart(10)}  ${curvatureSummary(system).meanAbsR.toFixed(3).padStart(9)}  ` +
        `${r.onPath.toFixed(3).padStart(7)}  ${r.mono.toFixed(3).padStart(9)}  ${r.reach.toFixed(2).padStart(6)}`
    );
  }
  console.log();
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
