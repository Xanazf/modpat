/**
 * Stage 3: WHY is the energy non-monotone, and by how much RELATIVE to its own
 * scale?
 *
 * Stage 2 found lambda* maxes out at 53.5 - 6x under the 3.2e2 monotonicity
 * ceiling - yet 48/48 runs show an energy rise. So the goal term is exonerated
 * and the cause is upstream, in the field. Hypotheses:
 *
 *   H1  cutoff discontinuity. forceFromCandidates only sums atoms inside
 *       sqrt(INFLUENCE_RADIUS)=20. An unshifted truncated potential jumps every
 *       time an atom crosses the cutoff, so V is discontinuous along a
 *       trajectory even though each term is smooth.
 *   H2  f is not -grad V. If the returned potential and the returned force come
 *       from different formulas, no Lyapunov function exists at all - a much
 *       bigger claim than a stiffness ceiling.
 *   H3  local field stiffness. The wells themselves are stiff enough that the
 *       same rotation-vs-contraction argument from stage 1 bites at the field's
 *       own curvature scale, independent of lambda.
 *
 * H2 is decisive and cheapest: finite-difference V and compare to f directly.
 *
 * Run: tsx scripts/dev/settle_goal_cause.ts
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import {
  buildGridIndex,
  getMetricForce,
  makeLocomotionState,
} from "@skill_cogi/Locomotion";
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

const phys = DOPAT_CONFIG.PHYSICS;
const dt = phys.SETTLE_TRAVERSE_DT;
const drag = 1 - phys.SETTLE_TRAVERSE_DAMPING * dt;

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
  const state = makeLocomotionState();
  buildGridIndex(system, state);

  const ids: number[] = [];
  for (let n = 0; n < graph.nodes.length; n++)
    if (nodeToPrecept[n] >= 0) ids.push(nodeToPrecept[n]);

  const V = (x: number, y: number, z: number, w: number): number =>
    getMetricForce(x, y, z, w, [], undefined, undefined, system, state, false)[0];
  const Fv = (
    x: number,
    y: number,
    z: number,
    w: number
  ): [number, number, number, number] => {
    const r = getMetricForce(
      x,
      y,
      z,
      w,
      [],
      undefined,
      undefined,
      system,
      state,
      false
    );
    return [r[1], r[2], r[3], r[4]];
  };

  // ---- H2: is f = -grad V? -------------------------------------------------
  console.log("\n=== H2: finite-difference check, f vs -grad V ===");
  console.log("sampled along the segment between random atom pairs\n");
  const h = 1e-4;
  let worstRel = 0;
  let worstAt = "";
  const rels: number[] = [];
  for (let k = 0; k < 200; k++) {
    const a = ids[k % ids.length];
    const b = ids[(k * 7 + 3) % ids.length];
    const s = ((k % 9) + 1) / 10;
    const x = system.posX[a] + (system.posX[b] - system.posX[a]) * s;
    const y = system.posY[a] + (system.posY[b] - system.posY[a]) * s;
    const z = system.posZ[a] + (system.posZ[b] - system.posZ[a]) * s;
    const w = system.posW[a] + (system.posW[b] - system.posW[a]) * s;

    const gx = (V(x + h, y, z, w) - V(x - h, y, z, w)) / (2 * h);
    const gy = (V(x, y + h, z, w) - V(x, y - h, z, w)) / (2 * h);
    const gz = (V(x, y, z + h, w) - V(x, y, z - h, w)) / (2 * h);
    const gw = (V(x, y, z, w + h) - V(x, y, z, w - h)) / (2 * h);
    const [fx, fy, fz, fw] = Fv(x, y, z, w);

    // Test BOTH sign conventions; report against whichever fits better.
    const dPlus = Math.hypot(fx - gx, fy - gy, fz - gz, fw - gw);
    const dMinus = Math.hypot(fx + gx, fy + gy, fz + gz, fw + gw);
    const gm = Math.hypot(gx, gy, gz, gw) || 1e-12;
    const rel = Math.min(dPlus, dMinus) / gm;
    rels.push(rel);
    if (rel > worstRel) {
      worstRel = rel;
      worstAt = `f=(${fx.toExponential(2)},${fy.toExponential(2)}) gradV=(${gx.toExponential(2)},${gy.toExponential(2)})`;
    }
  }
  rels.sort((p, q) => p - q);
  console.log(`median relative mismatch = ${rels[100].toExponential(3)}`);
  console.log(`p90    relative mismatch = ${rels[180].toExponential(3)}`);
  console.log(`worst  relative mismatch = ${worstRel.toExponential(3)}`);
  console.log(`worst sample: ${worstAt}`);
  console.log(
    rels[100] < 1e-3
      ? "VERDICT: f IS -grad V (H2 rejected - a potential exists)"
      : "VERDICT: f is NOT -grad V (H2 CONFIRMED - no Lyapunov function exists)"
  );

  // ---- Scale: how big are the rises relative to E? -------------------------
  console.log("\n=== relative magnitude of the energy rise ===");
  const src = ids[0],
    tgt = ids[5];
  const lambda = 13.19; // stage-2 median lambda*
  const tx = system.posX[tgt],
    ty = system.posY[tgt],
    tz = system.posZ[tgt],
    tw = system.posW[tgt];
  let px = system.posX[src],
    py = system.posY[src],
    pz = system.posZ[src],
    pw = system.posW[src];
  let vx = 0,
    vy = 0,
    vz = 0,
    vw = 0;
  let prevE: number | null = null;
  let maxRise = 0,
    maxRelRise = 0,
    eMin = Infinity,
    eMax = -Infinity;
  let riseSteps = 0,
    total = 0;
  let prevCands = -1;
  let riseWithCandChange = 0;

  for (let t = 0; t < phys.SETTLE_TRAVERSE_MAX_STEPS; t++) {
    const r = getMetricForce(
      px,
      py,
      pz,
      pw,
      [],
      undefined,
      undefined,
      system,
      state,
      false
    );
    const nCands = state._candScratch.length;
    const dxg = px - tx,
      dyg = py - ty,
      dzg = pz - tz,
      dwg = pw - tw;
    const E =
      0.5 * (vx * vx + vy * vy + vz * vz + vw * vw) +
      r[0] +
      0.5 * lambda * (dxg * dxg + dyg * dyg + dzg * dzg + dwg * dwg);
    eMin = Math.min(eMin, E);
    eMax = Math.max(eMax, E);
    if (prevE !== null) {
      total++;
      const d = E - prevE;
      if (d > 1e-12) {
        riseSteps++;
        maxRise = Math.max(maxRise, d);
        maxRelRise = Math.max(maxRelRise, d / Math.max(Math.abs(prevE), 1e-12));
        if (nCands !== prevCands) riseWithCandChange++;
      }
    }
    prevE = E;
    prevCands = nCands;

    vx = (vx + dt * (-r[1] - lambda * dxg)) * drag;
    vy = (vy + dt * (-r[2] - lambda * dyg)) * drag;
    vz = (vz + dt * (-r[3] - lambda * dzg)) * drag;
    vw = (vw + dt * (-r[4] - lambda * dwg)) * drag;
    px += dt * vx;
    py += dt * vy;
    pz += dt * vz;
    pw += dt * vw;
    if (vx * vx + vy * vy + vz * vz + vw * vw < 1e-8) break;
  }

  console.log(`steps=${total}  E range=[${eMin.toExponential(3)}, ${eMax.toExponential(3)}]`);
  console.log(`rising steps      = ${riseSteps}/${total} (${((100 * riseSteps) / total).toFixed(1)}%)`);
  console.log(`max abs rise      = ${maxRise.toExponential(3)}`);
  console.log(`max RELATIVE rise = ${maxRelRise.toExponential(3)}`);
  console.log(
    `rises coinciding with a candidate-set change: ${riseWithCandChange}/${riseSteps} ` +
      `(${riseSteps ? ((100 * riseWithCandChange) / riseSteps).toFixed(1) : "n/a"}%)   <- H1 evidence`
  );
  console.log();
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
