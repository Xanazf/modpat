/**
 * Prototype 2: a proper integrator for Lyapunov settling - does it fix the
 * forward-Euler energy injection from proto 1, and stay graph-faithful?
 * Run: tsx scripts/dev/settling_verlet_proto.ts
 *
 * Compares three damped-settling integrators of  v̇ = −∇V − γv  in 4D, released
 * from a gradient point (midpoint between two graph-distant atoms, so there is
 * something to descend - starting AT an atom starts you in a well):
 *   - euler   : forward/semi-implicit Euler (proto 1; injects energy in steep V)
 *   - verlet  : symmetric velocity-Verlet + exponential drag (energy-clean)
 *   - d3       : d3-force-3d's recipe (impulse → v*=velocityDecay → p+=v) + alpha
 *                cooling (anneal forces by alpha → 0), generalised to 4D.
 *
 * d3-force-3d itself is 3D-capped (no W axis), so we adopt its scheme rather than
 * the library. Reports per integrator: worst per-step ΔE (≤0 ⇒ monotone), net
 * energy descent, settle rate, and faithful-step (consecutive visited atoms
 * graph-adjacent).
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import {
  bfsHopDistances,
  undirectedAdjacency,
} from "@core_s/grounding/GroundGraph";
import { extractAstTriples } from "@utils/astExtract";

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

type Integrator = "euler" | "verlet" | "d3";

async function main(): Promise<void> {
  (DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;
  const phys = DOPAT_CONFIG.PHYSICS as { CONFORMAL_ENABLED: boolean };
  phys.CONFORMAL_ENABLED = false; // full un-muted wells

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
  const mapper = new Traveler(system);
  (mapper as any).buildGridIndex();

  const adj = undirectedAdjacency(graph);
  const preceptToNode = new Map<number, number>();
  const allocated: number[] = [];
  for (let n = 0; n < graph.nodes.length; n++) {
    const p = nodeToPrecept[n];
    if (p >= 0) {
      preceptToNode.set(p, n);
      allocated.push(p);
    }
  }
  const force = (x: number, y: number, z: number, w: number) =>
    (mapper as any).getMetricForce(x, y, z, w, [], undefined) as number[];
  const nearestAtom = (x: number, y: number, z: number, w: number): number => {
    let best = -1,
      bestD = Infinity;
    for (const id of allocated) {
      const dx = system.posX[id] - x,
        dy = system.posY[id] - y,
        dz = system.posZ[id] - z,
        dw = system.posW[id] - w;
      const d = dx * dx + dy * dy + dz * dz + dw * dw;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  };

  // Release from the midpoint of two atoms (gradient present), settle.
  function settle(srcId: number, tgtId: number, integ: Integrator) {
    const dt = 0.05,
      gamma = 2.0;
    const maxT = 1200;
    let px = (system.posX[srcId] + system.posX[tgtId]) / 2,
      py = (system.posY[srcId] + system.posY[tgtId]) / 2,
      pz = (system.posZ[srcId] + system.posZ[tgtId]) / 2,
      pw = (system.posW[srcId] + system.posW[tgtId]) / 2;
    let vx = 0,
      vy = 0,
      vz = 0,
      vw = 0;
    // accel = −∇V = −force
    let [, ax, ay, az, aw] = force(px, py, pz, pw);
    ax = -ax;
    ay = -ay;
    az = -az;
    aw = -aw;
    const decay = Math.exp(-gamma * dt); // exponential drag per step
    const halfDrag = Math.exp((-gamma * dt) / 2);
    // d3 cooling
    let alpha = 1;
    const alphaDecay = 1 - 0.001 ** (1 / 400);
    const velocityDecay = 0.6;

    let prevE = Infinity,
      worstdE = -Infinity,
      firstE = Infinity,
      lastE = Infinity;
    const walk: number[] = [];
    let lastNode = preceptToNode.get(srcId) ?? -1;
    let finalSpeed = 0;
    for (let t = 0; t < maxT; t++) {
      if (integ === "euler") {
        vx = (vx + dt * ax) * decay;
        vy = (vy + dt * ay) * decay;
        vz = (vz + dt * az) * decay;
        vw = (vw + dt * aw) * decay;
        px += dt * vx;
        py += dt * vy;
        pz += dt * vz;
        pw += dt * vw;
        const f = force(px, py, pz, pw);
        ax = -f[1];
        ay = -f[2];
        az = -f[3];
        aw = -f[4];
      } else if (integ === "verlet") {
        // symmetric velocity-Verlet + half-drag splitting
        vx = vx * halfDrag + (ax * dt) / 2;
        vy = vy * halfDrag + (ay * dt) / 2;
        vz = vz * halfDrag + (az * dt) / 2;
        vw = vw * halfDrag + (aw * dt) / 2;
        px += dt * vx;
        py += dt * vy;
        pz += dt * vz;
        pw += dt * vw;
        const f = force(px, py, pz, pw);
        ax = -f[1];
        ay = -f[2];
        az = -f[3];
        aw = -f[4];
        vx = (vx + (ax * dt) / 2) * halfDrag;
        vy = (vy + (ay * dt) / 2) * halfDrag;
        vz = (vz + (az * dt) / 2) * halfDrag;
        vw = (vw + (aw * dt) / 2) * halfDrag;
      } else {
        // d3-force-3d recipe in 4D: impulse (force·alpha) → friction → move.
        alpha += (0 - alpha) * alphaDecay;
        vx = (vx + ax * alpha) * velocityDecay;
        vy = (vy + ay * alpha) * velocityDecay;
        vz = (vz + az * alpha) * velocityDecay;
        vw = (vw + aw * alpha) * velocityDecay;
        px += vx;
        py += vy;
        pz += vz;
        pw += vw;
        const f = force(px, py, pz, pw);
        ax = -f[1];
        ay = -f[2];
        az = -f[3];
        aw = -f[4];
      }
      const speed2 = vx * vx + vy * vy + vz * vz + vw * vw;
      const V = force(px, py, pz, pw)[0];
      const E = 0.5 * speed2 + V;
      if (t === 0) firstE = E;
      else worstdE = Math.max(worstdE, E - prevE);
      prevE = E;
      lastE = E;
      finalSpeed = Math.sqrt(speed2);
      const node = preceptToNode.get(nearestAtom(px, py, pz, pw));
      if (node !== undefined && node !== lastNode) {
        walk.push(node);
        lastNode = node;
      }
      if (integ === "d3" ? alpha < 0.0015 : finalSpeed < 1e-4) break;
    }
    return { walk, worstdE, finalSpeed, netDescent: firstE - lastE };
  }

  // Sample graph-distant atom pairs.
  const pairs: Array<[number, number]> = [];
  const stride = Math.max(1, Math.floor(allocated.length / 8));
  for (let i = 0; i < allocated.length && pairs.length < 24; i += stride) {
    const si = preceptToNode.get(allocated[i])!;
    const dist = bfsHopDistances(si, adj);
    for (let j = 0; j < allocated.length && pairs.length < 24; j++) {
      const tj = preceptToNode.get(allocated[j])!;
      if (Number.isFinite(dist[tj]) && dist[tj] >= 2) {
        pairs.push([allocated[i], allocated[j]]);
        break;
      }
    }
  }

  console.log(
    "\nSettling integrators (conformal OFF, release from midpoint)\n"
  );
  console.log(
    `${"integrator".padEnd(10)}  ${"settled".padStart(8)}  ${"netDescent".padStart(11)}  ${"worstΔE".padStart(10)}  ${"faithfulStep".padStart(12)}`
  );
  for (const integ of ["euler", "verlet", "d3"] as Integrator[]) {
    let settled = 0,
      descentSum = 0,
      worstdEmax = -Infinity;
    let faithfulNum = 0,
      faithfulDen = 0,
      trials = 0;
    for (const [s, t] of pairs) {
      const r = settle(s, t, integ);
      trials++;
      if (r.finalSpeed < 1e-3 || integ === "d3") settled++;
      descentSum += r.netDescent;
      worstdEmax = Math.max(worstdEmax, r.worstdE);
      for (let k = 0; k + 1 < r.walk.length; k++) {
        faithfulDen++;
        if (bfsHopDistances(r.walk[k], adj)[r.walk[k + 1]] === 1) faithfulNum++;
      }
    }
    console.log(
      `${integ.padEnd(10)}  ${((settled / trials) * 100).toFixed(0).padStart(7)}%  ` +
        `${(descentSum / trials).toFixed(3).padStart(11)}  ${worstdEmax.toExponential(1).padStart(10)}  ` +
        `${(faithfulDen ? faithfulNum / faithfulDen : 0).toFixed(3).padStart(12)}`
    );
  }
  phys.CONFORMAL_ENABLED = true;
  console.log();
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
