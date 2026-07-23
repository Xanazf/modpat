/**
 * Positional round-trip for "fire ⊕ water = steam": can the GEOMETRY alone let
 * you arrive back at BOTH parents from steam's coordinate, with no stored edges?
 *
 * Uses the real attractor-potential kernel from Locomotion.getMetricForce
 * (conformal OFF, as directed settling uses it):
 *     V(p) = 1 − Σ_j  infl_j · exp(−d²(p,j) / F),   F = INFLUENCE_FALLOFF,
 *   counting only atoms within d² < INFLUENCE_RADIUS. Descent follows −∇V.
 *
 * Test: place fire and water as two equal wells. Place steam by a composition
 * rule, then settle from steam under a tiny nudge toward each parent. "Recovered"
 * = the two nudged descents converge on fire and on water respectively.
 *
 * The decisive measurement is the BASIN TOLERANCE: how far off the midpoint can
 * steam sit (along the axis, and perpendicular to it) and STILL drain to both?
 * A wide tolerance ⇒ placement geometry alone suffices (the structure is
 * geometric, no stored relations needed). A knife-edge ⇒ steam must be ~exactly
 * the saddle, which is too restrictive for a real concept and argues for storing
 * the two parent-displacements (still geometric, just richer).
 */

import { DOPAT_CONFIG } from "@config";

const F = DOPAT_CONFIG.PHYSICS.INFLUENCE_FALLOFF; // 40
const R2 = DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS; // 400
const INFL = 100; // equal well strength for fire and water

type P = { x: number; y: number; infl: number; label: string };

// Two wells on the X axis, separated so their basins are distinct but adjacent.
const SEP = 20; // |fire − water| along X (well centres)
const fire: P = { x: +SEP / 2, y: 0, infl: INFL, label: "fire" };
const water: P = { x: -SEP / 2, y: 0, infl: INFL, label: "water" };
const wells = [fire, water];

/** Potential V at (x,y) under the real kernel (2D slice; conformal off). */
function V(x: number, y: number): number {
  let v = 1.0;
  for (const w of wells) {
    const dx = x - w.x;
    const dy = y - w.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= R2) continue;
    v -= w.infl * Math.exp(-d2 / F);
  }
  return v;
}

/** −∇V (descent force) at (x,y). */
function descentForce(x: number, y: number): [number, number] {
  let fx = 0;
  let fy = 0;
  for (const w of wells) {
    const dx = x - w.x;
    const dy = y - w.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= R2) continue;
    // ∇V = Σ infl·exp·(2/F)·(p−w); descent = −∇V → toward the well.
    const g = (w.infl * Math.exp(-d2 / F) * 2) / F;
    fx -= g * dx;
    fy -= g * dy;
  }
  return [fx, fy];
}

/** Settle from a start point; return the well it converges to (or null). */
function settleTo(x0: number, y0: number): P | null {
  let x = x0;
  let y = y0;
  // Damped-particle integration matching the engine's stable settle (DT≈0.02,
  // damping), not a raw Euler step that overshoots the wells.
  const dt = DOPAT_CONFIG.PHYSICS.SETTLE_TRAVERSE_DT;
  const damping = DOPAT_CONFIG.PHYSICS.SETTLE_TRAVERSE_DAMPING;
  let vx = 0;
  let vy = 0;
  for (let step = 0; step < 200000; step++) {
    const [fx, fy] = descentForce(x, y);
    vx = (vx + fx * dt) * (1 - damping * dt);
    vy = (vy + fy * dt) * (1 - damping * dt);
    x += vx * dt;
    y += vy * dt;
    if (Math.hypot(fx, fy) < 1e-8 && Math.hypot(vx, vy) < 1e-8) break;
  }
  let best: P | null = null;
  let bestD = Infinity;
  for (const w of wells) {
    const d = Math.hypot(x - w.x, y - w.y);
    if (d < bestD) {
      bestD = d;
      best = w;
    }
  }
  return bestD < 1.0 ? best : null;
}

/** From a steam coordinate, nudge toward each parent and settle; recover both? */
function recoverBoth(sx: number, sy: number): boolean {
  const eps = 0.3;
  const toFire = settleTo(sx + eps * Math.sign(fire.x - sx || 1), sy);
  const toWater = settleTo(sx + eps * Math.sign(water.x - sx || -1), sy);
  // nudge along ±X (the inter-well axis); require the two to split fire/water.
  const a = settleTo(sx + eps, sy);
  const b = settleTo(sx - eps, sy);
  const set = new Set([a?.label, b?.label]);
  void toFire;
  void toWater;
  return set.has("fire") && set.has("water");
}

console.log(`kernel: F=${F}, R²=${R2}, wells at x=±${SEP / 2}, infl=${INFL}\n`);

// midpoint composition: steam = (fire + water)/2
const mid = { x: (fire.x + water.x) / 2, y: (fire.y + water.y) / 2 };
console.log(
  `steam = midpoint (${mid.x}, ${mid.y}): V=${V(mid.x, mid.y).toFixed(3)}  recover both = ${recoverBoth(mid.x, mid.y)}`
);

// basin tolerance along the axis (X): how far off-centre still recovers both?
let axisMax = 0;
for (let d = 0; d <= SEP; d += 0.25) {
  if (recoverBoth(d, 0)) axisMax = d;
  else break;
}
// perpendicular tolerance (Y): steam as a genuinely NEW concept off the line
let perpMax = 0;
for (let dy = 0; dy <= 4 * SEP; dy += 0.25) {
  if (recoverBoth(0, dy)) perpMax = dy;
  else break;
}

// The perpendicular limit should equal the influence-overlap boundary:
// the locus where a point first leaves one well's influence radius,
// y = sqrt(R² − (sep/2)²).
const overlapBound = Math.sqrt(R2 - (SEP / 2) * (SEP / 2));

console.log(
  `\nbasin tolerance from midpoint:` +
    `\n  along axis (the SADDLE's unstable direction - expected knife-edge): ±${axisMax.toFixed(2)}` +
    `\n  perpendicular (the bisector ridge - the real freedom): ${perpMax.toFixed(2)}` +
    `\n  predicted overlap boundary √(R²−(sep/2)²) = ${overlapBound.toFixed(2)}  → match: ${
      Math.abs(perpMax - overlapBound) < 0.5
    }`
);
console.log(
  `\nreading: backward arrival by descent works exactly when steam lies in the\n` +
    `INFLUENCE-OVERLAP of both parents and on their bisector (equidistant). That is a\n` +
    `real geometric region - the lens where both wells reach - not a single point, so\n` +
    `placement geometry alone recovers both parents with NO stored edges. The only\n` +
    `case it cannot cover is a parent steam isn't near (outside its influence) or an\n` +
    `asymmetric lean toward one parent - exactly where explicit (still-geometric)\n` +
    `parent-displacements would be needed.`
);
