/**
 * Sanity check on the stage-4 result: three identical rows (production /
 * xyz-only / w-corrected all 20/48) means the modes did not diverge. The
 * likely reason is that the grounded corpus is W-degenerate - if every atom
 * shares a posW, then dw ~ 0, the temporal factor exp(-TD*max(0,dw)) ~ 1, the
 * omitted gradient term is ~0, and W carries no dynamics to correct.
 *
 * This reports the corpus W spread and the actual magnitude distribution of the
 * energy rises, so the verdict is not read off a median that is structurally 0.
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

  const ws = ids.map(i => system.posW[i]);
  const uniqW = new Set(ws.map(w => w.toFixed(6)));
  console.log("\n=== corpus W spread ===");
  console.log(`atoms=${ids.length}  distinct posW=${uniqW.size}`);
  console.log(
    `posW min=${Math.min(...ws).toFixed(4)}  max=${Math.max(...ws).toFixed(4)}  range=${(Math.max(...ws) - Math.min(...ws)).toFixed(6)}`
  );

  // How big is the omitted W gradient term, relative to the computed one?
  let maxRatio = 0;
  const ratios: number[] = [];
  for (let k = 0; k < 300; k++) {
    const a = ids[k % ids.length];
    const b = ids[(k * 7 + 3) % ids.length];
    const s = ((k % 9) + 1) / 10;
    const px = system.posX[a] + (system.posX[b] - system.posX[a]) * s;
    const py = system.posY[a] + (system.posY[b] - system.posY[a]) * s;
    const pz = system.posZ[a] + (system.posZ[b] - system.posZ[a]) * s;
    const pw = system.posW[a] + (system.posW[b] - system.posW[a]) * s;
    let gw = 0,
      missing = 0;
    for (const j of ids) {
      const dx = px - system.posX[j],
        dy = py - system.posY[j],
        dz = pz - system.posZ[j],
        dw = pw - system.posW[j];
      const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
      if (d2 >= phys.INFLUENCE_RADIUS) continue;
      let infl = system.density[j] * 2 + system.intensity[j] * 1.5 + 5;
      const st = system.slotType[j];
      if (st & SlotTypeBody) infl += phys.BODY_SLOT_ATTRACTION;
      if (st & SlotTypeCondition) infl += phys.COND_SLOT_ATTRACTION;
      const e = infl * Math.exp(-TD * Math.max(0, dw)) * Math.exp(-d2 / F);
      gw += (2 * e * dw) / F;
      if (dw > 0) missing += e * TD;
    }
    const r = Math.abs(missing) / Math.max(Math.abs(gw), 1e-12);
    ratios.push(r);
    maxRatio = Math.max(maxRatio, r);
  }
  ratios.sort((a, b) => a - b);
  console.log("\n=== omitted W gradient term vs computed W force ===");
  console.log(`median ratio |missing|/|computed| = ${ratios[150].toExponential(3)}`);
  console.log(`max    ratio                      = ${maxRatio.toExponential(3)}`);

  // Magnitude distribution of energy rises, production mode, true potential.
  console.log("\n=== energy-rise magnitudes (production, true U) ===");
  const rises: number[] = [];
  for (let p = 0; p < 48; p++) {
    const s = ids[p % ids.length];
    const t = ids[(p * 5 + 1) % ids.length];
    if (s === t) continue;
    const tx = system.posX[t],
      ty = system.posY[t],
      tz = system.posZ[t],
      tw = system.posW[t];
    let px = system.posX[s],
      py = system.posY[s],
      pz = system.posZ[s],
      pw = system.posW[s];
    let vx = 0,
      vy = 0,
      vz = 0,
      vw = 0;
    const lambda = 13.19;
    let prevE: number | null = null;
    let mx = 0;
    for (let it = 0; it < phys.SETTLE_TRAVERSE_MAX_STEPS; it++) {
      const r = getMetricForce(px, py, pz, pw, [], undefined, undefined, system, state, false);
      let U = 0;
      for (const j of ids) {
        const dx = px - system.posX[j],
          dy = py - system.posY[j],
          dz = pz - system.posZ[j],
          dw = pw - system.posW[j];
        const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
        if (d2 >= phys.INFLUENCE_RADIUS) continue;
        let infl = system.density[j] * 2 + system.intensity[j] * 1.5 + 5;
        const st = system.slotType[j];
        if (st & SlotTypeBody) infl += phys.BODY_SLOT_ATTRACTION;
        if (st & SlotTypeCondition) infl += phys.COND_SLOT_ATTRACTION;
        U -= infl * Math.exp(-TD * Math.max(0, dw)) * Math.exp(-d2 / F);
      }
      const dxg = px - tx,
        dyg = py - ty,
        dzg = pz - tz,
        dwg = pw - tw;
      const E =
        0.5 * (vx * vx + vy * vy + vz * vz + vw * vw) +
        U +
        0.5 * lambda * (dxg * dxg + dyg * dyg + dzg * dzg + dwg * dwg);
      if (prevE !== null) mx = Math.max(mx, (E - prevE) / Math.max(Math.abs(prevE), 1e-12));
      prevE = E;
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
    rises.push(mx);
  }
  rises.sort((a, b) => a - b);
  const nz = rises.filter(r => r > 1e-9);
  console.log(`runs=${rises.length}  with a rise=${nz.length}`);
  if (nz.length > 0) {
    console.log(
      `rise magnitudes: min=${nz[0].toExponential(2)}  median=${nz[Math.floor(nz.length / 2)].toExponential(2)}  max=${nz[nz.length - 1].toExponential(2)}`
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
