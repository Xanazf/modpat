/**
 * C4 retarget experiment - does a learned Christoffel correction ΔΓ have a
 * place in the SETTLING traversal? (Roadmap Phase-4 open item: "re-evaluate C4
 * with a fidelity-shaped reward against the settling walk, or retire it
 * explicitly the way C3 Ricci flow was.")
 *
 * Background: C4's ΔΓ force is consumed only by relaxPath's relaxation loop
 * and its ±reward fires only in relaxPath's review loop - with
 * SETTLING_TRAVERSE_PRIMARY=true both are dormant, so C4 is currently inert.
 * The only retarget that would matter is injecting ΔΓ into the settle itself.
 *
 * Two measurements decide it:
 *   1. SWEEP - random ΔΓ tensors at increasing magnitude, scored by
 *      traversalFidelity on the grounded corpus AND by discrete energy descent
 *      (the Christoffel force is quadratic in velocity and non-dissipative, so
 *      it has no Lyapunov guarantee - violations should grow with ‖ΔΓ‖).
 *   2. HILL-CLIMB - the fidelity-shaped reward itself: perturb ΔΓ, keep if
 *      onPath improves. If the climb cannot beat ΔΓ=0, there is nothing for
 *      C4 to learn on the settling path.
 *
 * Run: tsx scripts/dev/c4_settling_retarget_diag.ts
 */

import { computeChristoffelForce } from "@_lib/math/TensorMath";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import {
  buildGridIndex,
  getMetricForce,
  makeLocomotionState,
} from "@skill_cogi/Locomotion";
import { extractAstTriples } from "@utils/astExtract";
import { random, seedRandom } from "@utils/seededRandom";

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

function shutdown(engine: Engine): void {
  engine.validate();
}
`;

const NO_PENALTIES: {
  x: number;
  y: number;
  z: number;
  w: number;
  strength: number;
}[] = [];

interface SettleStats {
  walk: Uint32Array;
  energyViolations: number;
  worstDE: number;
}

/** Production _settleOnce + an injected Christoffel force −Γ(v,v) from dG. */
function settleOnceGamma(
  sourceId: number,
  targetId: number,
  lambda: number,
  dG: Float64Array,
  system: System,
  state: Cognition.LocomotionState
): { walk: number[]; arrived: boolean; violations: number; worstDE: number } {
  const phys = DOPAT_CONFIG.PHYSICS;
  const dt = phys.SETTLE_TRAVERSE_DT;
  const gamma = phys.SETTLE_TRAVERSE_DAMPING;
  const innerMax = phys.SETTLE_TRAVERSE_MAX_STEPS;
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
  const walk: number[] = [sourceId];
  let lastId = sourceId;
  const drag = 1 - gamma * dt;
  const cf = new Float64Array(4);
  const vv = new Float64Array(4);
  let prevE = Number.POSITIVE_INFINITY;
  let violations = 0;
  let worstDE = 0;

  for (let t = 0; t < innerMax; t++) {
    const [V, fx, fy, fz, fw] = getMetricForce(
      px,
      py,
      pz,
      pw,
      NO_PENALTIES,
      undefined,
      undefined,
      system,
      state,
      false
    );

    // Energy BEFORE the step (kinetic + field potential + goal-bias potential).
    const dxT = px - tx,
      dyT = py - ty,
      dzT = pz - tz,
      dwT = pw - tw;
    const E =
      0.5 * (vx * vx + vy * vy + vz * vz + vw * vw) +
      V +
      0.5 * lambda * (dxT * dxT + dyT * dyT + dzT * dzT + dwT * dwT);
    if (t > 0 && E > prevE + 1e-9) {
      violations++;
      if (E - prevE > worstDE) worstDE = E - prevE;
    }
    prevE = E;

    vv[0] = vx;
    vv[1] = vy;
    vv[2] = vz;
    vv[3] = vw;
    computeChristoffelForce(vv, dG, cf);

    vx = (vx + dt * (-fx - lambda * dxT - cf[0])) * drag;
    vy = (vy + dt * (-fy - lambda * dyT - cf[1])) * drag;
    vz = (vz + dt * (-fz - lambda * dzT - cf[2])) * drag;
    vw = (vw + dt * (-fw - lambda * dwT - cf[3])) * drag;
    px += dt * vx;
    py += dt * vy;
    pz += dt * vz;
    pw += dt * vw;

    const nId = state.gridIndex.nearest(
      px,
      py,
      pz,
      pw,
      nearR,
      system,
      undefined
    );
    if (nId >= 0 && nId !== lastId) {
      walk.push(nId);
      lastId = nId;
    }
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
  return { walk, arrived: finalNearest === targetId, violations, worstDE };
}

/** Production settleDirectedPath (escalate-until-arrival) with dG injected. */
function settleGamma(
  sourceId: number,
  targetId: number,
  dG: Float64Array,
  system: System,
  state: Cognition.LocomotionState,
  stats: { violations: number; worstDE: number }
): SettleStats {
  buildGridIndex(system, state);
  const phys = DOPAT_CONFIG.PHYSICS;
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
    NO_PENALTIES,
    undefined,
    undefined,
    system,
    state,
    false
  );
  const fMag = Math.hypot(fm[1], fm[2], fm[3], fm[4]);
  let lambda =
    (phys.SETTLE_TRAVERSE_LAMBDA0_FRACTION * Math.max(fMag, 1e-9)) / D0;
  let last = settleOnceGamma(sourceId, targetId, lambda, dG, system, state);
  let esc = 0;
  while (!last.arrived && esc < phys.SETTLE_TRAVERSE_MAX_ESCALATIONS) {
    lambda *= 2;
    esc++;
    last = settleOnceGamma(sourceId, targetId, lambda, dG, system, state);
  }
  stats.violations += last.violations;
  if (last.worstDE > stats.worstDE) stats.worstDE = last.worstDE;
  return {
    walk: new Uint32Array(last.walk),
    energyViolations: last.violations,
    worstDE: last.worstDE,
  };
}

function randomGamma(scale: number): Float64Array {
  const dG = new Float64Array(64);
  for (let i = 0; i < 64; i++) dG[i] = (random() * 2 - 1) * scale;
  return dG;
}

function gammaNorm(dG: Float64Array): number {
  let s = 0;
  for (let i = 0; i < 64; i++) s += dG[i] * dG[i];
  return Math.sqrt(s);
}

async function main(): Promise<void> {
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

  const score = async (dG: Float64Array) => {
    const stats = { violations: 0, worstDE: 0 };
    const r = await traversalFidelity(
      graph,
      nodeToPrecept,
      (s, t) =>
        Promise.resolve(settleGamma(s, t, dG, system, state, stats).walk),
      { maxPairs: 32 }
    );
    return { r, stats };
  };

  console.log("=== 1. sweep: random ΔΓ at increasing magnitude ===");
  const zero = await score(new Float64Array(64));
  console.log(
    `  ‖ΔΓ‖=0.000   reach=${zero.r.reachRate.toFixed(2)} onPath=${zero.r.onPathRate.toFixed(3)} ` +
      `monotonic=${zero.r.monotonicity.toFixed(3)} energy-violations=${zero.stats.violations} ` +
      `worstΔE=${zero.stats.worstDE.toExponential(2)}`
  );
  for (const scale of [0.001, 0.01, 0.1]) {
    for (let seed = 1; seed <= 2; seed++) {
      seedRandom(seed * 100 + scale * 1000);
      const dG = randomGamma(scale);
      const { r, stats } = await score(dG);
      console.log(
        `  ‖ΔΓ‖=${gammaNorm(dG).toFixed(3)} reach=${r.reachRate.toFixed(2)} onPath=${r.onPathRate.toFixed(3)} ` +
          `monotonic=${r.monotonicity.toFixed(3)} energy-violations=${stats.violations} ` +
          `worstΔE=${stats.worstDE.toExponential(2)}`
      );
    }
  }

  console.log("\n=== 2. hill-climb: fidelity-shaped reward on ΔΓ ===");
  seedRandom(42);
  let best = new Float64Array(64);
  let bestScore = zero.r.onPathRate;
  console.log(`  round 0 (ΔΓ=0): onPath=${bestScore.toFixed(3)}`);
  for (let round = 1; round <= 10; round++) {
    const candidate = Float64Array.from(best);
    const perturb = randomGamma(0.01);
    for (let i = 0; i < 64; i++) candidate[i] += perturb[i];
    const { r } = await score(candidate);
    const kept = r.onPathRate > bestScore;
    if (kept) {
      best = candidate;
      bestScore = r.onPathRate;
    }
    console.log(
      `  round ${round}: onPath=${r.onPathRate.toFixed(3)} ${kept ? "KEPT" : "rejected"}`
    );
  }
  console.log(
    `\n  final: best onPath=${bestScore.toFixed(3)} at ‖ΔΓ‖=${gammaNorm(best).toFixed(4)} ` +
      `(baseline ΔΓ=0: ${zero.r.onPathRate.toFixed(3)})`
  );
  console.log(
    bestScore > zero.r.onPathRate + 0.02
      ? "  -> ΔΓ helps the settle; C4 retarget is worth pursuing."
      : "  -> the fidelity reward finds nothing for ΔΓ to learn; retire C4 with C3."
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
