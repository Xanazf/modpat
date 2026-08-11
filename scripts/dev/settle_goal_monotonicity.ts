/**
 * Does the settling goal term preserve monotone energy descent?
 *
 * settleDirectedPath already IS a boundary-value solver: _settleOnce integrates
 * `a = -grad V_field - lambda*(p - tgt)`, a harmonic spring to the goal, with
 * lambda escalated (doubled, up to MAX_ESCALATIONS) until the settled point's
 * nearest atom is the target.
 *
 * Both force terms are conservative, so the CONTINUOUS system has a Lyapunov
 * function E = 1/2|v|^2 + V_field(p) + 1/2*lambda*|p-tgt|^2 that decreases under
 * damping for any lambda. The question is whether the DISCRETE integrator at
 * fixed dt inherits that, because escalate-until-arrival deliberately drives
 * lambda upward and a stiff spring at fixed dt is the classic way to lose it.
 *
 * Stage 1 (this file, no manifold): replicate the exact update rule on the pure
 * spring, find the empirical lambda at which descent breaks, and check it
 * against the closed form.
 *
 * Closed form. With u = p - tgt and drag = 1 - gamma*dt, one step is
 *   v' = drag*v - drag*dt*lambda*u
 *   u' = (1 - drag*dt^2*lambda)*u + drag*dt*v
 * whose 2x2 matrix has det = drag (independent of lambda!) and
 * trace = 1 + drag - drag*dt^2*lambda. Schur stability for a real 2x2 needs
 * |trace| < 1 + det, and the binding side is trace > -(1+det), giving
 *   lambda_crit = 2*(1 + drag) / (drag * dt^2).
 */

import { DOPAT_CONFIG } from "@config";

const phys = DOPAT_CONFIG.PHYSICS;
const dt = phys.SETTLE_TRAVERSE_DT;
const gamma = phys.SETTLE_TRAVERSE_DAMPING;
const drag = 1 - gamma * dt;
const innerMax = phys.SETTLE_TRAVERSE_MAX_STEPS;

const lambdaCrit = (2 * (1 + drag)) / (drag * dt * dt);

/**
 * Runs the production update rule on a 1-D pure spring (V_field = 0) and
 * reports the largest single-step energy INCREASE seen. Monotone descent means
 * this is <= 0 up to floating-point noise.
 */
function springDescent(
  lambda: number,
  u0 = 1
): { maxRise: number; finalU: number; diverged: boolean } {
  let u = u0;
  let v = 0;
  const energy = (uu: number, vv: number): number =>
    0.5 * vv * vv + 0.5 * lambda * uu * uu;
  let prev = energy(u, v);
  let maxRise = -Infinity;
  for (let t = 0; t < innerMax; t++) {
    v = (v - dt * lambda * u) * drag;
    u += dt * v;
    if (!Number.isFinite(u) || Math.abs(u) > 1e12)
      return { maxRise: Infinity, finalU: u, diverged: true };
    const e = energy(u, v);
    maxRise = Math.max(maxRise, e - prev);
    prev = e;
  }
  return { maxRise, finalU: u, diverged: false };
}

/** Bisect for the smallest lambda whose run shows a strict energy rise. */
function empiricalCritical(): number {
  let lo = 1e-6;
  let hi = 1;
  while (springDescent(hi).maxRise <= 1e-12 && hi < 1e12) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = Math.sqrt(lo * hi);
    if (springDescent(mid).maxRise <= 1e-12) lo = mid;
    else hi = mid;
  }
  return hi;
}

function main(): void {
  console.log("=== settling goal term: discrete monotonicity ===\n");
  console.log(
    `dt=${dt}  gamma=${gamma}  drag=${drag.toFixed(4)}  innerMax=${innerMax}`
  );
  console.log(`maxEscalations=${phys.SETTLE_TRAVERSE_MAX_ESCALATIONS}`);
  console.log(`lambda0Fraction=${phys.SETTLE_TRAVERSE_LAMBDA0_FRACTION}\n`);

  const emp = empiricalCritical();
  console.log(`predicted lambda_crit = ${lambdaCrit.toExponential(4)}`);
  console.log(`empirical  lambda_crit = ${emp.toExponential(4)}`);
  console.log(`ratio                  = ${(emp / lambdaCrit).toFixed(6)}\n`);

  console.log("lambda        maxEnergyRise   |u_final|      verdict");
  for (const mult of [1e-4, 1e-2, 0.5, 0.9, 0.99, 1.01, 1.1, 2, 10, 1e3]) {
    const lam = lambdaCrit * mult;
    const r = springDescent(lam);
    const verdict = r.diverged
      ? "DIVERGED"
      : r.maxRise > 1e-12
        ? "NON-MONOTONE"
        : "monotone";
    console.log(
      `${lam.toExponential(3).padEnd(13)} ${(r.diverged ? "inf" : r.maxRise.toExponential(3)).padEnd(15)} ${(r.diverged ? "inf" : Math.abs(r.finalU).toExponential(2)).padEnd(14)} ${verdict}`
    );
  }

  // How much escalation headroom does a run have before it crosses the ceiling?
  console.log("\n=== escalation reach ===");
  const esc = phys.SETTLE_TRAVERSE_MAX_ESCALATIONS;
  const span = 2 ** esc;
  console.log(`escalation span = 2^${esc} = ${span.toExponential(3)}`);
  console.log(
    `a run crosses lambda_crit iff lambda0 > ${(lambdaCrit / span).toExponential(3)}`
  );
  console.log(
    "\nlambda0 = LAMBDA0_FRACTION * |F(probe)| / D0, so the crossing test is\n" +
      "empirical: stage 2 measures real lambda0 and lambda* on a live manifold."
  );
}

main();
