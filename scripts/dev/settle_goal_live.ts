/**
 * Stage 2: what lambda do REAL traversals reach, and does the real energy
 * (field potential included) descend monotonically at that lambda?
 *
 * Stage 1 (settle_goal_monotonicity.ts) established, on the pure spring:
 *   - divergence ceiling  lambda ~ 1.03e4 (closed form, 1% accurate)
 *   - MONOTONICITY ceiling lambda ~ 3.2e2, 32x lower - the discrete map stays
 *     stable but its per-step rotation carries energy uphill faster than the
 *     3%/step contraction removes it.
 *
 * This file replicates _settleOnce / settleDirectedPath exactly (same constants,
 * same update order, same arrival test) with instrumentation, and runs it on the
 * grounded TS corpus used by traverse_shadow_compare.ts. It measures the true
 * Lyapunov candidate
 *     E = 1/2|v|^2 + V_field(p) + 1/2*lambda*|p - tgt|^2
 * using getMetricForce's potential channel, so the verdict covers the real
 * field, not just the spring.
 *
 * Run: tsx scripts/dev/settle_goal_live.ts
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
const gamma = phys.SETTLE_TRAVERSE_DAMPING;
const drag = 1 - gamma * dt;
const innerMax = phys.SETTLE_TRAVERSE_MAX_STEPS;

const LAMBDA_MONOTONE_CEILING = 3.1915e2; // stage-1 empirical
const LAMBDA_DIVERGE_CEILING = 1.0319e4; // stage-1 closed form

interface SettleTrace {
  arrived: boolean;
  maxRise: number;
  steps: number;
}

/** _settleOnce, instrumented with the total-energy trace. */
function settleOnceTraced(
  sourceId: number,
  targetId: number,
  lambda: number,
  system: Root.ManifoldView,
  state: Cognition.LocomotionState
): SettleTrace {
  const nearR = Math.sqrt(phys.INFLUENCE_RADIUS) * 4;
  const tx = system.posX[targetId],
    ty = system.posY[targetId],
    tz = system.posZ[targetId],
    tw = system.posW[targetId];
  let px = system.posX[sourceId],
    py = system.posY[sourceId],
    pz = system.posZ[sourceId],
    pw = system.posW[sourceId];
  let vx = 0,
    vy = 0,
    vz = 0,
    vw = 0;
  let maxRise = -Infinity;
  let prevE: number | null = null;
  let steps = 0;

  for (let t = 0; t < innerMax; t++) {
    const [V, fx, fy, fz, fw] = getMetricForce(
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
    const dxg = px - tx,
      dyg = py - ty,
      dzg = pz - tz,
      dwg = pw - tw;
    const E =
      0.5 * (vx * vx + vy * vy + vz * vz + vw * vw) +
      V +
      0.5 * lambda * (dxg * dxg + dyg * dyg + dzg * dzg + dwg * dwg);
    if (prevE !== null && Number.isFinite(E) && Number.isFinite(prevE))
      maxRise = Math.max(maxRise, E - prevE);
    prevE = E;
    steps = t + 1;

    vx = (vx + dt * (-fx - lambda * dxg)) * drag;
    vy = (vy + dt * (-fy - lambda * dyg)) * drag;
    vz = (vz + dt * (-fz - lambda * dzg)) * drag;
    vw = (vw + dt * (-fw - lambda * dwg)) * drag;
    px += dt * vx;
    py += dt * vy;
    pz += dt * vz;
    pw += dt * vw;
    if (!Number.isFinite(px)) break;
    if (vx * vx + vy * vy + vz * vz + vw * vw < 1e-8) break;
  }

  const finalNearest = state.gridIndex.nearest(
    px,
    py,
    pz,
    pw,
    nearR,
    system,
    undefined
  );
  return { arrived: finalNearest === targetId, maxRise, steps };
}

interface PairResult {
  lambda0: number;
  lambdaStar: number;
  escalations: number;
  arrived: boolean;
  maxRise: number;
  steps: number;
}

/** settleDirectedPath's lambda0 probe + escalate-until-arrival, instrumented. */
function directedTraced(
  sourceId: number,
  targetId: number,
  system: Root.ManifoldView,
  state: Cognition.LocomotionState
): PairResult {
  const F = phys.INFLUENCE_FALLOFF;
  const sx = system.posX[sourceId],
    sy = system.posY[sourceId],
    sz = system.posZ[sourceId],
    sw = system.posW[sourceId];
  const dx = system.posX[targetId] - sx,
    dy = system.posY[targetId] - sy,
    dz = system.posZ[targetId] - sz,
    dw = system.posW[targetId] - sw;
  const D0 = Math.hypot(dx, dy, dz, dw) || 1e-9;
  const probe = Math.min(Math.sqrt(F / 2), D0 * 0.5) / D0;
  const fm = getMetricForce(
    sx + dx * probe,
    sy + dy * probe,
    sz + dz * probe,
    sw + dw * probe,
    [],
    undefined,
    undefined,
    system,
    state,
    false
  );
  const fMag = Math.hypot(fm[1], fm[2], fm[3], fm[4]);
  const lambda0 =
    (phys.SETTLE_TRAVERSE_LAMBDA0_FRACTION * Math.max(fMag, 1e-9)) / D0;

  let lambda = lambda0;
  let last = settleOnceTraced(sourceId, targetId, lambda, system, state);
  let esc = 0;
  while (!last.arrived && esc < phys.SETTLE_TRAVERSE_MAX_ESCALATIONS) {
    lambda *= 2;
    esc++;
    last = settleOnceTraced(sourceId, targetId, lambda, system, state);
  }
  return {
    lambda0,
    lambdaStar: lambda,
    escalations: esc,
    arrived: last.arrived,
    maxRise: last.maxRise,
    steps: last.steps,
  };
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

function quant(xs: number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
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
  const state = makeLocomotionState();
  buildGridIndex(system, state);

  const ids: number[] = [];
  for (let n = 0; n < graph.nodes.length; n++)
    if (nodeToPrecept[n] >= 0) ids.push(nodeToPrecept[n]);

  const pairs: Array<[number, number]> = [];
  outer: for (let i = 0; i < ids.length; i++)
    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue;
      pairs.push([ids[i], ids[j]]);
      if (pairs.length >= 48) break outer;
    }

  console.log("\n=== settling goal term on a live manifold ===");
  console.log(`corpus atoms=${ids.length}  pairs=${pairs.length}`);
  console.log(
    `monotonicity ceiling lambda=${LAMBDA_MONOTONE_CEILING.toExponential(3)}  ` +
      `divergence ceiling lambda=${LAMBDA_DIVERGE_CEILING.toExponential(3)}\n`
  );

  const results = pairs.map(([s, t]) => directedTraced(s, t, system, state));

  const arrived = results.filter(r => r.arrived);
  const nonMono = results.filter(r => r.maxRise > 1e-9);
  const overMono = results.filter(r => r.lambdaStar > LAMBDA_MONOTONE_CEILING);
  const overDiv = results.filter(r => r.lambdaStar > LAMBDA_DIVERGE_CEILING);

  const l0 = results.map(r => r.lambda0);
  const ls = results.map(r => r.lambdaStar);
  const escs = results.map(r => r.escalations);

  console.log(`arrived              ${arrived.length}/${results.length}  (${pct(arrived.length, results.length)})`);
  console.log(
    `lambda0   median=${quant(l0, 0.5).toExponential(3)}  max=${Math.max(...l0).toExponential(3)}`
  );
  console.log(
    `lambda*   median=${quant(ls, 0.5).toExponential(3)}  p90=${quant(ls, 0.9).toExponential(3)}  max=${Math.max(...ls).toExponential(3)}`
  );
  console.log(
    `escalations median=${quant(escs, 0.5)}  max=${Math.max(...escs)}\n`
  );

  console.log(
    `lambda* over MONOTONICITY ceiling  ${overMono.length}/${results.length}  (${pct(overMono.length, results.length)})`
  );
  console.log(
    `lambda* over DIVERGENCE   ceiling  ${overDiv.length}/${results.length}  (${pct(overDiv.length, results.length)})`
  );
  console.log(
    `MEASURED non-monotone energy       ${nonMono.length}/${results.length}  (${pct(nonMono.length, results.length)})\n`
  );

  const arrivedNonMono = arrived.filter(r => r.maxRise > 1e-9).length;
  console.log(
    `of the ${arrived.length} that ARRIVED, ${arrivedNonMono} did so non-monotonically (${pct(arrivedNonMono, arrived.length)})`
  );

  console.log("\nlambda*        esc  arrived  maxEnergyRise   monotone?");
  for (const r of results.slice(0, 16)) {
    console.log(
      `${r.lambdaStar.toExponential(3).padEnd(14)} ${String(r.escalations).padEnd(4)} ` +
        `${String(r.arrived).padEnd(8)} ${r.maxRise.toExponential(3).padEnd(15)} ` +
        `${r.maxRise > 1e-9 ? "NO" : "yes"}`
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
