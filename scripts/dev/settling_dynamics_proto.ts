/**
 * Prototype: Lyapunov settling dynamics as the faithful inference substrate.
 * Run: tsx scripts/dev/settling_dynamics_proto.ts
 *
 * Instead of relaxing a fixed-endpoint path (an ill-conditioned boundary-value
 * problem), release a damped particle at the source and let it fall through the
 * attractor field:
 *     v̇ = −∇V − γ·v ,   E = ½|v|² + V ,   dE/dt = −γ|v|² ≤ 0.
 * Energy is a Lyapunov function: monotone descent + settling are guaranteed for
 * ANY potential, however steep - so the ill-conditioning that broke path
 * relaxation is a non-issue. The open question is FAITHFULNESS: does the
 * settling trajectory visit graph-adjacent atoms (a connected structural walk),
 * or teleport? Uses the FULL un-muted wells (conformal off).
 *
 * Reports per drag γ: Lyapunov-monotone fraction, settling (final |v|), and the
 * faithful-step fraction (consecutive distinct visited atoms that are graph
 * neighbours, hop = 1).
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

async function main(): Promise<void> {
  (DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;
  const phys = DOPAT_CONFIG.PHYSICS as { CONFORMAL_ENABLED: boolean };
  phys.CONFORMAL_ENABLED = false; // full un-muted attractor wells

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
  const potential = (x: number, y: number, z: number, w: number) =>
    force(x, y, z, w)[0];
  const nearestAtom = (x: number, y: number, z: number, w: number): number => {
    let best = -1;
    let bestD = Infinity;
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

  // Damped settling from a source atom; returns the visited graph-node walk,
  // whether energy stayed monotone, and the final speed.
  function settleFrom(srcPrecept: number, gamma: number, dt: number) {
    const maxT = Math.round(30 / dt);
    let px = system.posX[srcPrecept],
      py = system.posY[srcPrecept],
      pz = system.posZ[srcPrecept],
      pw = system.posW[srcPrecept];
    let vx = 0,
      vy = 0,
      vz = 0,
      vw = 0;
    let prevE = Infinity;
    let worstdE = -Infinity;
    let firstE = Infinity;
    let lastE = Infinity;
    const walk: number[] = [];
    let lastNode = preceptToNode.get(srcPrecept) ?? -1;
    if (lastNode >= 0) walk.push(lastNode);
    let finalSpeed = 0;
    for (let t = 0; t < maxT; t++) {
      const [V, fx, fy, fz, fw] = force(px, py, pz, pw); // f = ∇V
      // semi-implicit: update velocity (−∇V − drag), then position.
      vx = (vx - dt * fx) * (1 - gamma * dt);
      vy = (vy - dt * fy) * (1 - gamma * dt);
      vz = (vz - dt * fz) * (1 - gamma * dt);
      vw = (vw - dt * fw) * (1 - gamma * dt);
      px += dt * vx;
      py += dt * vy;
      pz += dt * vz;
      pw += dt * vw;
      const speed2 = vx * vx + vy * vy + vz * vz + vw * vw;
      const E = 0.5 * speed2 + potential(px, py, pz, pw);
      if (t === 0) firstE = E;
      if (t > 0) worstdE = Math.max(worstdE, E - prevE);
      prevE = E;
      lastE = E;
      finalSpeed = Math.sqrt(speed2);
      // record visited atom (deduped)
      const na = nearestAtom(px, py, pz, pw);
      const node = preceptToNode.get(na);
      if (node !== undefined && node !== lastNode) {
        walk.push(node);
        lastNode = node;
      }
      if (finalSpeed < 1e-4) break;
    }
    return { walk, worstdE, finalSpeed, netDescent: firstE - lastE };
  }

  for (const dt of [0.05, 0.01]) {
    console.log(
      `\nLyapunov settling dynamics (conformal OFF, full wells), dt=${dt}\n`
    );
    console.log(
      `${"drag γ".padStart(7)}  ${"settled".padStart(8)}  ${"netDescent".padStart(11)}  ${"worstΔE".padStart(10)}  ${"faithfulStep".padStart(12)}  ${"meanWalkLen".padStart(11)}`
    );
    for (const gamma of [1, 2, 4, 8]) {
      let settled = 0;
      let faithfulNum = 0;
      let faithfulDen = 0;
      let walkLenSum = 0;
      let descentSum = 0;
      let worstdEmax = -Infinity;
      let trials = 0;
      const stride = Math.max(1, Math.floor(allocated.length / 16));
      for (let s = 0; s < allocated.length; s += stride) {
        const r = settleFrom(allocated[s], gamma, dt);
        trials++;
        if (r.finalSpeed < 1e-3) settled++;
        walkLenSum += r.walk.length;
        descentSum += r.netDescent;
        worstdEmax = Math.max(worstdEmax, r.worstdE);
        for (let k = 0; k + 1 < r.walk.length; k++) {
          const d = bfsHopDistances(r.walk[k], adj)[r.walk[k + 1]];
          faithfulDen++;
          if (d === 1) faithfulNum++;
        }
      }
      const faithful = faithfulDen > 0 ? faithfulNum / faithfulDen : 0;
      console.log(
        `${gamma.toFixed(1).padStart(7)}  ${((settled / trials) * 100).toFixed(0).padStart(7)}%  ` +
          `${(descentSum / trials).toFixed(2).padStart(11)}  ${worstdEmax.toExponential(1).padStart(10)}  ` +
          `${faithful.toFixed(3).padStart(12)}  ${(walkLenSum / trials).toFixed(1).padStart(11)}`
      );
    }
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
