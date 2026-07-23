/**
 * Prototype: can an adaptive integration step keep the relaxation's discrete
 * action monotonically decreasing WITHOUT the conformal e^{-2φ} force mute?
 * Run: tsx scripts/dev/newtonian_relax_proto.ts
 *
 * Background: mapper_review.test.ts guards that gradient descent on
 *   A = Σ|Δp|² + Σ 2·V(p)   (V from getMetricForce)
 * decreases monotonically at lr=0.01. The conformal factor was acting as an
 * implicit adaptive step (it shrank the force, hence the action's gradient
 * Lipschitz constant, in dense regions). Removing it (the faithfulness win)
 * overshoots by ~1.5e-5. The Newtonian-faithful replacement keeps the full
 * attractor force and moves dissipation into the integrator: a step that
 * shrinks where the force is large. This does NOT move the force-balance fixed
 * point, so the converged geodesic (and thus fidelity) is unchanged.
 *
 * We compare three configs on two scenarios and report the worst (most
 * positive) action increase per iteration - it must be ≤ 0 (monotonic).
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";

type Force = (
  px: number,
  py: number,
  pz: number,
  pw: number
) => [number, number, number, number, number];

type StepControl =
  | { kind: "fixed" }
  | { kind: "adaptiveK"; k: number }
  | { kind: "cap"; maxStep: number };

function runRelax(
  force: Force,
  init: { x: number; y: number; z: number; w: number }[],
  baseLr: number,
  ctrl: StepControl
): { actions: number[]; worstIncrease: number } {
  const steps = init.length - 1;
  const px = new Float64Array(steps + 1);
  const py = new Float64Array(steps + 1);
  const pe = new Float64Array(steps + 1);
  const pa = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    px[i] = init[i].x;
    py[i] = init[i].y;
    pe[i] = init[i].z;
    pa[i] = init[i].w;
  }
  const action = (): number => {
    let a = 0;
    for (let i = 1; i <= steps; i++) {
      const dx = px[i] - px[i - 1],
        dy = py[i] - py[i - 1],
        de = pe[i] - pe[i - 1],
        da = pa[i] - pa[i - 1];
      a += dx * dx + dy * dy + de * de + da * da;
    }
    for (let i = 1; i < steps; i++)
      a += 2.0 * force(px[i], py[i], pe[i], pa[i])[0];
    return a;
  };
  const actions: number[] = [];
  for (let iter = 0; iter < 40; iter++) {
    actions.push(action());
    for (let i = 1; i < steps; i++) {
      const [, fx, fy, fz, fw] = force(px[i], py[i], pe[i], pa[i]);
      const sx = (px[i - 1] + px[i + 1]) / 2 - px[i];
      const sy = (py[i - 1] + py[i + 1]) / 2 - py[i];
      const se = (pe[i - 1] + pe[i + 1]) / 2 - pe[i];
      const sa = (pa[i - 1] + pa[i + 1]) / 2 - pa[i];
      // Descent direction on the action.
      const gx = sx * 2.0 - fx,
        gy = sy * 2.0 - fy,
        gz = se * 2.0 - fz,
        gw = sa * 2.0 - fw;
      // Step control (dissipation in the integrator; same force-balance fixed
      // point, so the converged geodesic is unchanged).
      let lr = baseLr;
      if (ctrl.kind === "adaptiveK") {
        const gmag = Math.sqrt(gx * gx + gy * gy + gz * gz + gw * gw);
        lr = baseLr / (1 + ctrl.k * gmag);
      } else if (ctrl.kind === "cap") {
        const gmag = Math.sqrt(gx * gx + gy * gy + gz * gz + gw * gw);
        const move = baseLr * gmag;
        if (move > ctrl.maxStep) lr = ctrl.maxStep / (gmag + 1e-12);
      }
      px[i] += lr * gx;
      py[i] += lr * gy;
      pe[i] += lr * gz;
      pa[i] += lr * gw;
    }
  }
  let worst = -Infinity;
  for (let i = 1; i < actions.length; i++)
    worst = Math.max(worst, actions[i] - actions[i - 1]);
  return { actions, worstIncrease: worst };
}

/**
 * Jacobi relaxation with backtracking line search: full (un-muted) attractor
 * force, but a global step that halves until the discrete action decreases.
 * Guarantees monotonicity by construction while allowing large faithful steps.
 */
function runLineSearch(
  force: Force,
  init: { x: number; y: number; z: number; w: number }[]
): { actions: number[]; worstIncrease: number } {
  const steps = init.length - 1;
  const px = new Float64Array(steps + 1),
    py = new Float64Array(steps + 1),
    pe = new Float64Array(steps + 1),
    pa = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) {
    px[i] = init[i].x;
    py[i] = init[i].y;
    pe[i] = init[i].z;
    pa[i] = init[i].w;
  }
  const actionOf = (
    ax: Float64Array,
    ay: Float64Array,
    ae: Float64Array,
    aw: Float64Array
  ): number => {
    let a = 0;
    for (let i = 1; i <= steps; i++) {
      const dx = ax[i] - ax[i - 1],
        dy = ay[i] - ay[i - 1],
        de = ae[i] - ae[i - 1],
        da = aw[i] - aw[i - 1];
      a += dx * dx + dy * dy + de * de + da * da;
    }
    for (let i = 1; i < steps; i++)
      a += 2.0 * force(ax[i], ay[i], ae[i], aw[i])[0];
    return a;
  };
  const gx = new Float64Array(steps + 1),
    gy = new Float64Array(steps + 1),
    ge = new Float64Array(steps + 1),
    gw = new Float64Array(steps + 1);
  const tx = new Float64Array(steps + 1),
    ty = new Float64Array(steps + 1),
    te = new Float64Array(steps + 1),
    ta = new Float64Array(steps + 1);
  const actions: number[] = [];
  for (let iter = 0; iter < 40; iter++) {
    const a0 = actionOf(px, py, pe, pa);
    actions.push(a0);
    // Jacobi gradients from the current state (all points at once).
    for (let i = 1; i < steps; i++) {
      const [, fx, fy, fz, fw] = force(px[i], py[i], pe[i], pa[i]);
      gx[i] = ((px[i - 1] + px[i + 1]) / 2 - px[i]) * 2.0 - fx;
      gy[i] = ((py[i - 1] + py[i + 1]) / 2 - py[i]) * 2.0 - fy;
      ge[i] = ((pe[i - 1] + pe[i + 1]) / 2 - pe[i]) * 2.0 - fz;
      gw[i] = ((pa[i - 1] + pa[i + 1]) / 2 - pa[i]) * 2.0 - fw;
    }
    let alpha = 0.1;
    for (let bt = 0; bt < 30; bt++) {
      for (let i = 1; i < steps; i++) {
        tx[i] = px[i] + alpha * gx[i];
        ty[i] = py[i] + alpha * gy[i];
        te[i] = pe[i] + alpha * ge[i];
        ta[i] = pa[i] + alpha * gw[i];
      }
      tx[0] = px[0];
      ty[0] = py[0];
      te[0] = pe[0];
      ta[0] = pa[0];
      tx[steps] = px[steps];
      ty[steps] = py[steps];
      te[steps] = pe[steps];
      ta[steps] = pa[steps];
      if (actionOf(tx, ty, te, ta) <= a0 + 1e-12) break;
      alpha *= 0.5;
    }
    for (let i = 1; i < steps; i++) {
      px[i] += alpha * gx[i];
      py[i] += alpha * gy[i];
      pe[i] += alpha * ge[i];
      pa[i] += alpha * gw[i];
    }
  }
  let worst = -Infinity;
  for (let i = 1; i < actions.length; i++)
    worst = Math.max(worst, actions[i] - actions[i - 1]);
  return { actions, worstIncrease: worst };
}

async function main(): Promise<void> {
  (DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;
  const phys = DOPAT_CONFIG.PHYSICS as { CONFORMAL_ENABLED: boolean };

  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();

  // Scenario 1: the mapper_review setup (two sparse attractors).
  const a = atomizer.ingestSequence("alpha", system)[0];
  const b = atomizer.ingestSequence("beta", system)[0];
  system.posX[a] = 0;
  system.posY[a] = 0;
  system.posZ[a] = 0.5;
  system.posW[a] = 0;
  system.posX[b] = 10;
  system.posY[b] = 0;
  system.posZ[b] = 0.5;
  system.posW[b] = 5;
  // Scenario 2: a dense cluster (where conformal saturated) around the path.
  for (let k = 0; k < 30; k++) {
    const id = atomizer.ingestSequence(`c${k}`, system)[0];
    system.posX[id] = 3 + (k % 6) * 0.7;
    system.posY[id] = ((k * 37) % 10) * 0.3 - 1.5;
    system.posZ[id] = 0.5;
    system.posW[id] = 1 + (k % 5) * 0.5;
  }
  const mapper = new Traveler(system);
  (mapper as any).buildGridIndex();
  const force: Force = (x, y, z, w) =>
    (mapper as any).getMetricForce(x, y, z, w, [], undefined);

  const steps = 16;
  const init = Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    return { x: t * 10, y: 0, z: 0.5, w: t * 5 };
  });

  // Note: a CONFORMAL_PHI_SCALE sweep (softening e^{-2φ/S}) was also tried and
  // showed NO sweet spot - every S was either monotonic-but-inert (S<=10) or
  // moving-but-divergent (S>=25); stability and inertness are the same thing
  // under fixed-step descent. That knob was reverted.

  // The would-be principled fix: full attractor force (conformal OFF) + backtracking
  // line search. Must be MONOTONIC and the action must actually drop (path moves).
  phys.CONFORMAL_ENABLED = false;
  const ls = runLineSearch(force, init);
  phys.CONFORMAL_ENABLED = true;
  console.log(
    "\nLine-search integrator (conformal OFF, full attractor force):"
  );
  console.log(
    `  worstΔaction=${ls.worstIncrease.toExponential(2)}  ` +
      `A_start→A_end=${ls.actions[0].toFixed(2)}→${ls.actions[ls.actions.length - 1].toFixed(2)}  ` +
      `${ls.worstIncrease <= 1e-9 ? "MONOTONIC" : "VIOLATED"}`
  );
  console.log();
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
