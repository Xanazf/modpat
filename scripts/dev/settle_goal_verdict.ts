/**
 * Stage 4 (verdict): monotonicity against the TRUE potential, and the fix.
 *
 * Correcting stage 3: the finite-difference test differentiated getMetricForce's
 * RETURNED V, which is `Math.max(0.01, V)` - saturated at the floor everywhere
 * the atoms are dense, hence flat. That is a clamped readout, not the potential.
 * The force itself is a real gradient field. With conformal OFF (settling's
 * regime) and A_B_FULL_GRADIENT=false, the potential is
 *
 *   U(p) = -SUM_j infl_j * exp(-TD * max(0, pw - posW_j)) * exp(-d2_j / F)
 *
 * and the code's fx,fy,fz are exactly dU/dx,dU/dy,dU/dz (the integrator applies
 * -f, giving a = -grad U). Correct and conservative in X/Y/Z.
 *
 * W is different. dU/dw picks up a SECOND term from differentiating the temporal
 * factor exp(-TD*max(0,dw)):
 *
 *   dU/dw = SUM_j e_j * (2*dw_j/F)        <- what the code computes
 *         + SUM_j e_j * TD * [dw_j > 0]   <- what the code OMITS
 *
 * An omitted gradient component is a non-conservative force: it does work around
 * closed loops, so no Lyapunov function of the form 1/2|v|^2 + U + spring can be
 * decreasing. TD = 3.0, so the omitted term is not a rounding detail.
 *
 * This file measures three regimes on the live corpus:
 *   A  production force, energy vs true U        - is it non-monotone?
 *   B  production force restricted to X/Y/Z      - is W the culprit?
 *   C  production force + the omitted W term     - does the fix restore descent?
 *
 * Run: tsx scripts/dev/settle_goal_verdict.ts
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
const F = phys.INFLUENCE_FALLOFF;
const TD = phys.PHI_TEMPORAL_DECAY;

const SlotTypeBody = 1 << 1;
const SlotTypeCondition = 1 << 2;

type Mode = "production" | "xyz-only" | "w-corrected";

/** The true potential U and its exact gradient, recomputed independently. */
function trueField(
  px: number,
  py: number,
  pz: number,
  pw: number,
  ids: number[],
  system: Root.ManifoldView
): { U: number; gx: number; gy: number; gz: number; gw: number; gwMissing: number } {
  let U = 0,
    gx = 0,
    gy = 0,
    gz = 0,
    gw = 0,
    gwMissing = 0;
  for (const j of ids) {
    const dx = px - system.posX[j],
      dy = py - system.posY[j],
      dz = pz - system.posZ[j],
      dw = pw - system.posW[j];
    const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
    if (d2 >= phys.INFLUENCE_RADIUS) continue;
    let infl = system.density[j] * 2.0 + system.intensity[j] * 1.5 + 5.0;
    const st = system.slotType[j];
    if (st & SlotTypeBody) infl += phys.BODY_SLOT_ATTRACTION;
    if (st & SlotTypeCondition) infl += phys.COND_SLOT_ATTRACTION;
    const td = Math.exp(-TD * Math.max(0, dw));
    const e = infl * td * Math.exp(-d2 / F);
    U -= e;
    const k = (2.0 * e) / F;
    gx += k * dx;
    gy += k * dy;
    gz += k * dz;
    gw += k * dw;
    if (dw > 0) gwMissing += e * TD;
  }
  return { U, gx, gy, gz, gw: gw + gwMissing, gwMissing };
}

interface Run {
  arrived: boolean;
  maxRelRise: number;
  risingFrac: number;
  steps: number;
}

function runSettle(
  sourceId: number,
  targetId: number,
  lambda: number,
  mode: Mode,
  ids: number[],
  system: Root.ManifoldView,
  state: Cognition.LocomotionState
): Run {
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
  let prevE: number | null = null;
  let maxRelRise = 0,
    rising = 0,
    total = 0,
    steps = 0;

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
    const tf = trueField(px, py, pz, pw, ids, system);
    const dxg = px - tx,
      dyg = py - ty,
      dzg = pz - tz,
      dwg = pw - tw;

    // Energy uses the TRUE potential; in xyz-only the W spring is absent too, so
    // its Lyapunov candidate must drop the W spring term to stay the right one.
    const springW = mode === "xyz-only" ? 0 : dwg * dwg;
    const E =
      0.5 * (vx * vx + vy * vy + vz * vz + vw * vw) +
      tf.U +
      0.5 * lambda * (dxg * dxg + dyg * dyg + dzg * dzg + springW);
    if (prevE !== null) {
      total++;
      const d = E - prevE;
      if (d > 1e-12) {
        rising++;
        maxRelRise = Math.max(maxRelRise, d / Math.max(Math.abs(prevE), 1e-12));
      }
    }
    prevE = E;
    steps = t + 1;

    let fw = r[4];
    if (mode === "w-corrected") fw += tf.gwMissing;

    vx = (vx + dt * (-r[1] - lambda * dxg)) * drag;
    vy = (vy + dt * (-r[2] - lambda * dyg)) * drag;
    vz = (vz + dt * (-r[3] - lambda * dzg)) * drag;
    vw =
      mode === "xyz-only" ? 0 : (vw + dt * (-fw - lambda * dwg)) * drag;
    px += dt * vx;
    py += dt * vy;
    pz += dt * vz;
    pw += dt * vw;
    if (!Number.isFinite(px)) break;
    if (vx * vx + vy * vy + vz * vz + vw * vw < 1e-8) break;
  }

  const nearest = state.gridIndex.nearest(
    px,
    py,
    pz,
    pw,
    nearR,
    system,
    undefined
  );
  return {
    arrived: nearest === targetId,
    maxRelRise,
    risingFrac: total ? rising / total : 0,
    steps,
  };
}

/** Escalate-until-arrival, per mode. */
function directed(
  s: number,
  t: number,
  mode: Mode,
  ids: number[],
  system: Root.ManifoldView,
  state: Cognition.LocomotionState
): Run & { lambdaStar: number } {
  const sx = system.posX[s],
    sy = system.posY[s],
    sz = system.posZ[s],
    sw = system.posW[s];
  const dx = system.posX[t] - sx,
    dy = system.posY[t] - sy,
    dz = system.posZ[t] - sz,
    dw = system.posW[t] - sw;
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
  let lambda =
    (phys.SETTLE_TRAVERSE_LAMBDA0_FRACTION * Math.max(fMag, 1e-9)) / D0;
  let last = runSettle(s, t, lambda, mode, ids, system, state);
  let esc = 0;
  while (!last.arrived && esc < phys.SETTLE_TRAVERSE_MAX_ESCALATIONS) {
    lambda *= 2;
    esc++;
    last = runSettle(s, t, lambda, mode, ids, system, state);
  }
  return { ...last, lambdaStar: lambda };
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

  console.log("\n=== VERDICT: monotonicity against the TRUE potential ===");
  console.log(`pairs=${pairs.length}  TD=${TD}  F=${F}\n`);
  console.log(
    "mode           arrived    non-monotone   median maxRelRise   median risingFrac"
  );

  for (const mode of ["production", "xyz-only", "w-corrected"] as Mode[]) {
    const rs = pairs.map(([s, t]) => directed(s, t, mode, ids, system, state));
    const arrived = rs.filter(r => r.arrived).length;
    const nonMono = rs.filter(r => r.maxRelRise > 1e-9).length;
    const med = (xs: number[]): number =>
      [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    console.log(
      `${mode.padEnd(14)} ${`${arrived}/${rs.length}`.padEnd(10)} ` +
        `${`${nonMono}/${rs.length}`.padEnd(14)} ` +
        `${med(rs.map(r => r.maxRelRise)).toExponential(3).padEnd(20)} ` +
        `${med(rs.map(r => r.risingFrac)).toFixed(3)}`
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
