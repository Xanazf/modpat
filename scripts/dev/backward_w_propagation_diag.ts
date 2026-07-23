/**
 * Backward-W propagation diagnostic (pre-P7 intermediate step #7).
 *
 * Falsifiable claim (NOTES.md "Rationalization vs. Reasoning"): once backward
 * propagation decay is wired, rationalizations are SYSTEMATICALLY lower
 * amplitude than forward-propagated conclusions, because they travel against
 * the established-knowledge gradient to reach their support.
 *
 * This drives `measureInferenceAmplitude` over many random inferences (a
 * conclusion at high W, premises scattered at lower W with random field
 * charges) and reports the backward/forward amplitude ratio. The claim holds
 * iff the ratio is < 1 on EVERY non-degenerate inference (a conclusion whose
 * premises are W-coincident has no direction to distinguish ⇒ ratio 1).
 *
 *   tsx scripts/dev/backward_w_propagation_diag.ts
 */

import Runtime from "@core_i/Runtime";
import {
  classifyInferenceDirection,
  measureInferenceAmplitude,
} from "@core_i/skills/cognition/DirectionalPropagation";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main() {
  const rt = await Runtime.boot({
    atomizer: "semantic",
    db: ":memory:",
    noTick: true,
    noLifecycle: true,
    skipIdentity: true,
    noWorkers: true,
  });
  await rt.ready;
  const sys = rt.system;
  const rng = mulberry32(0xc0ffee);

  // Carve a scratch region past the live frontier so we never collide with
  // boot precepts, and place a conclusion + premises with controlled W/charge.
  let next = sys.length + 16;
  const place = (w: number, density: number, intensity: number): number => {
    const id = next++;
    sys.allocated[id] = 1;
    if (id >= sys.length) sys.length = id + 1;
    sys.posW[id] = w;
    sys.density[id] = density;
    sys.intensity[id] = intensity;
    sys.mass[id] = 1;
    return id;
  };

  const TRIALS = 500;
  let minRatio = Number.POSITIVE_INFINITY;
  let maxRatio = Number.NEGATIVE_INFINITY;
  let sumRatio = 0;
  let violations = 0; // backward >= forward on a non-degenerate inference
  let degenerate = 0;

  for (let t = 0; t < TRIALS; t++) {
    const wc = 50 + rng() * 50; // conclusion fires "now" (high W)
    const conclusion = place(wc, rng() * 5, rng() * 5);
    const nPrem = 1 + Math.floor(rng() * 5);
    const premises: number[] = [];
    let coincident = true;
    for (let p = 0; p < nPrem; p++) {
      // Premises are OLDER (lower W); occasionally W-coincident.
      const dw = rng() < 0.1 ? 0 : rng() * wc;
      if (dw > 1e-9) coincident = false;
      premises.push(place(wc - dw, rng() * 5, rng() * 5));
    }

    const { forward, backward, ratio } = classifyInferenceDirection(
      sys,
      conclusion,
      premises
    );
    if (coincident) {
      degenerate++;
      // Direction is meaningless; amplitudes must be equal.
      if (Math.abs(forward - backward) > 1e-9) violations++;
      continue;
    }
    if (backward >= forward) violations++;
    minRatio = Math.min(minRatio, ratio);
    maxRatio = Math.max(maxRatio, ratio);
    sumRatio += ratio;
  }

  const nNonDegen = TRIALS - degenerate;
  console.log(`trials                 ${TRIALS}`);
  console.log(`degenerate (Δw=0)      ${degenerate}`);
  console.log(`non-degenerate         ${nNonDegen}`);
  console.log(`violations (bwd ≥ fwd) ${violations}`);
  console.log(
    `ratio min / mean / max ${minRatio.toFixed(4)} / ${(
      sumRatio / Math.max(1, nNonDegen)
    ).toFixed(4)} / ${maxRatio.toFixed(4)}`
  );

  // A worked single example for legibility.
  const c = place(100, 3, 3);
  const near = place(98, 3, 3); // recent premise
  const far = place(20, 3, 3); // ancient premise
  const fwd = measureInferenceAmplitude(sys, c, [near, far], "reasoning");
  const bwd = measureInferenceAmplitude(sys, c, [near, far], "rationalization");
  console.log(
    `\nexample  forward=${fwd.amplitude.toFixed(3)}  ` +
      `backward=${bwd.amplitude.toFixed(3)}  ` +
      `ratio=${(bwd.amplitude / fwd.amplitude).toFixed(4)}`
  );
  console.log(
    "per-premise backward decay (older premises attenuate more):",
    bwd.contributions
      .map(cc => `dw=${cc.dw.toFixed(0)}→amp=${cc.amplitude.toFixed(2)}`)
      .join("  ")
  );

  const verdict =
    violations === 0
      ? "CLAIM HOLDS: backward support is systematically lower amplitude."
      : `CLAIM FAILS: ${violations} violation(s).`;
  console.log(`\n${verdict}`);
  process.exit(violations === 0 ? 0 : 1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
