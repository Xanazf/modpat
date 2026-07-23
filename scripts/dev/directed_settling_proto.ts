/**
 * Prototype: DIRECTED fidelity of Lyapunov settling - does the connected walk
 * reach the CORRECT conclusion, not just a graph-adjacent one?
 * Run: tsx scripts/dev/directed_settling_proto.ts
 *
 * Increment 6 proved settling produces a CONNECTED walk (0.98–1.00 of consecutive
 * visited atoms are graph-neighbours) but left the load-bearing question open:
 * connected ≠ correct. A walk can hop along real edges yet drift to the wrong
 * minimum. This measures the directed question with the SAME metrics as
 * TraversalFidelity (onPath / monotonicity / reach), but driven by settling
 * dynamics instead of relaxPath.
 *
 * Pure settling has no target - it falls to the nearest well (the incr-6
 * "released at the source atom ⇒ tiny netDescent" trap). So we add a target pull
 *     U(p) = ½·λ·|p − tgt|² ,   a = −∇V_field − λ·(p − tgt) − γ·v.
 * E = ½|v|² + V_field + U is still a Lyapunov function (settling guaranteed for
 * any λ), but now the otherwise-flat field has a descent direction toward the
 * intended conclusion. Sweeping λ:
 *   - λ = 0  : unbiased - does the FIELD ALONE route to tgt? (is the intended
 *              conclusion the natural field minimum?)
 *   - λ small: just enough goal pull to escape the source well; the route should
 *              still thread the graph geodesic (high onPath).
 *   - λ large: the pull dominates and the particle beelines to tgt, shortcutting
 *              the structure (onPath should fall - the falsifiable failure mode).
 *
 * A position-shuffle null (faithful map destroyed) confirms onPath is structural,
 * not an artifact of the metric. Conformal OFF (full un-muted wells).
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

interface DirectedReport {
  pairs: number;
  reachRate: number;
  /** Walk's closest approach to tgt is within 1 hop (stalled one short = ok). */
  nearReachRate: number;
  monotonicity: number;
  onPathRate: number;
  meanWalkLen: number;
  /** Mean graph-hops from the walk's final node to tgt (0 = arrived). */
  meanFinalDist: number;
}

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
    {
      seed: 0,
    }
  );
  const mapper = new Traveler(system);

  const adj = undirectedAdjacency(graph);
  const preceptToNode = new Map<number, number>();
  const nodeToP: number[] = [];
  const allocated: number[] = [];
  for (let n = 0; n < graph.nodes.length; n++) {
    const p = nodeToPrecept[n];
    nodeToP[n] = p;
    if (p >= 0) {
      preceptToNode.set(p, n);
      allocated.push(p);
    }
  }

  // Rebuild the grid against the CURRENT positions (re-callable after a shuffle).
  const rebuild = () => (mapper as any).buildGridIndex();
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

  // Goal-biased damped settle src → tgt. Returns the visited graph-node walk.
  function settleDirected(
    srcId: number,
    tgtId: number,
    lambda: number
  ): number[] {
    const dt = 0.02,
      gamma = 3.0;
    const maxT = Math.round(40 / dt);
    const tx = system.posX[tgtId],
      ty = system.posY[tgtId],
      tz = system.posZ[tgtId],
      tw = system.posW[tgtId];
    let px = system.posX[srcId],
      py = system.posY[srcId],
      pz = system.posZ[srcId],
      pw = system.posW[srcId];
    let vx = 0,
      vy = 0,
      vz = 0,
      vw = 0;
    const walk: number[] = [];
    let lastNode = preceptToNode.get(srcId) ?? -1;
    if (lastNode >= 0) walk.push(lastNode);
    for (let t = 0; t < maxT; t++) {
      const [, fx, fy, fz, fw] = force(px, py, pz, pw); // f = ∇V_field
      // a = −∇V_field − λ(p − tgt); semi-implicit Euler with velocity drag.
      const ax = -fx - lambda * (px - tx),
        ay = -fy - lambda * (py - ty),
        az = -fz - lambda * (pz - tz),
        aw = -fw - lambda * (pw - tw);
      const drag = 1 - gamma * dt;
      vx = (vx + dt * ax) * drag;
      vy = (vy + dt * ay) * drag;
      vz = (vz + dt * az) * drag;
      vw = (vw + dt * aw) * drag;
      px += dt * vx;
      py += dt * vy;
      pz += dt * vz;
      pw += dt * vw;
      const node = preceptToNode.get(nearestAtom(px, py, pz, pw));
      if (node !== undefined && node !== lastNode) {
        walk.push(node);
        lastNode = node;
      }
      if (vx * vx + vy * vy + vz * vz + vw * vw < 1e-8) break;
    }
    return walk;
  }

  // One clean directed settle from src at a fixed λ, recording the visited-atom
  // walk and reporting whether the settled point's nearest atom IS the target
  // (the graph-free arrival test available at inference time).
  function settleOnce(
    srcId: number,
    tgtId: number,
    lambda: number
  ): { walk: number[]; arrived: boolean } {
    const dt = 0.02,
      gamma = 3.0;
    const tx = system.posX[tgtId],
      ty = system.posY[tgtId],
      tz = system.posZ[tgtId],
      tw = system.posW[tgtId];
    let px = system.posX[srcId],
      py = system.posY[srcId],
      pz = system.posZ[srcId],
      pw = system.posW[srcId];
    let vx = 0,
      vy = 0,
      vz = 0,
      vw = 0;
    const walk: number[] = [];
    let lastNode = preceptToNode.get(srcId) ?? -1;
    if (lastNode >= 0) walk.push(lastNode);
    const innerMax = Math.round(40 / dt);
    for (let t = 0; t < innerMax; t++) {
      const [, fx, fy, fz, fw] = force(px, py, pz, pw);
      const ax = -fx - lambda * (px - tx),
        ay = -fy - lambda * (py - ty),
        az = -fz - lambda * (pz - tz),
        aw = -fw - lambda * (pw - tw);
      const drag = 1 - gamma * dt;
      vx = (vx + dt * ax) * drag;
      vy = (vy + dt * ay) * drag;
      vz = (vz + dt * az) * drag;
      vw = (vw + dt * aw) * drag;
      px += dt * vx;
      py += dt * vy;
      pz += dt * vz;
      pw += dt * vw;
      const node = preceptToNode.get(nearestAtom(px, py, pz, pw));
      if (node !== undefined && node !== lastNode) {
        walk.push(node);
        lastNode = node;
      }
      if (vx * vx + vy * vy + vz * vz + vw * vw < 1e-8) break;
    }
    return { walk, arrived: nearestAtom(px, py, pz, pw) === tgtId };
  }

  // Self-calibrating directed settle: NO hardcoded λ. The sweep proved the
  // onPath peak coincides with the reach knee (the smallest bias that arrives is
  // the most faithful; more bias only beelines). So escalate λ by doubling until
  // a FRESH settle from src arrives (graph-free arrival test), then return THAT
  // round's clean walk - λ-search and path-emission are separated, so the
  // reported path is a single un-polluted settle at λ*, not the union of the
  // exploratory rounds. λ₀ is scale-aware (a fraction of a midpoint field-force
  // probe over the start→target distance) so the escalation count is bounded.
  function settleAdaptive(
    srcId: number,
    tgtId: number
  ): { walk: number[]; lambda: number; escalations: number } {
    const tx = system.posX[tgtId],
      ty = system.posY[tgtId],
      tz = system.posZ[tgtId],
      tw = system.posW[tgtId];
    const sx = system.posX[srcId],
      sy = system.posY[srcId],
      sz = system.posZ[srcId],
      sw = system.posW[srcId];
    const dx = tx - sx,
      dy = ty - sy,
      dz = tz - sz,
      dw = tw - sw;
    const D0 = Math.hypot(dx, dy, dz, dw);
    // Probe the SOURCE WELL WALL (not the inter-cluster midpoint, which is empty
    // space reading ~0): step ≈√(F/2) off src toward tgt, where the Gaussian
    // well's gradient peaks and scales with well depth - so λ₀ auto-tracks the
    // force scale. λ₀ sets the initial bias force to ~10% of that wall force
    // (deliberately too weak; the escalator climbs from there).
    const F = (DOPAT_CONFIG.PHYSICS as { INFLUENCE_FALLOFF: number })
      .INFLUENCE_FALLOFF;
    const probe = Math.min(Math.sqrt(F / 2), D0 * 0.5) / Math.max(D0, 1e-9);
    const fm = force(
      sx + dx * probe,
      sy + dy * probe,
      sz + dz * probe,
      sw + dw * probe
    );
    const fMag = Math.hypot(fm[1], fm[2], fm[3], fm[4]);
    let lambda = (0.1 * Math.max(fMag, 1e-9)) / Math.max(D0, 1e-9);
    const maxEsc = 28;
    let last = settleOnce(srcId, tgtId, lambda);
    let escalations = 0;
    while (!last.arrived && escalations < maxEsc) {
      lambda *= 2;
      escalations++;
      last = settleOnce(srcId, tgtId, lambda);
    }
    return { walk: last.walk, lambda, escalations };
  }

  // Same strided far-pair sampling as TraversalFidelity.
  const pairs: Array<[number, number, number]> = []; // [srcNode, tgtNode, dist]
  const n = graph.nodes.length;
  const stride = Math.max(1, Math.floor(n / 32));
  for (let src = 0; src < n && pairs.length < 48; src += stride) {
    if (nodeToP[src] < 0) continue;
    const dFrom = bfsHopDistances(src, adj);
    for (let tgt = 0; tgt < n && pairs.length < 48; tgt++) {
      if (tgt === src || nodeToP[tgt] < 0) continue;
      const d = dFrom[tgt];
      if (Number.isFinite(d) && d >= 2) pairs.push([src, tgt, d]);
    }
  }

  function score(lambda: number): DirectedReport {
    let reached = 0,
      nearReached = 0,
      finalDistSum = 0,
      pathProducing = 0,
      monoSum = 0,
      walkLenSum = 0,
      onPathHits = 0,
      interiorTotal = 0;
    for (const [srcNode, tgtNode, graphDist] of pairs) {
      const dFrom = bfsHopDistances(srcNode, adj);
      const dTo = bfsHopDistances(tgtNode, adj);
      const seq = settleDirected(nodeToP[srcNode], nodeToP[tgtNode], lambda);
      walkLenSum += seq.length;
      if (seq.includes(tgtNode)) reached++;
      let closest = Infinity;
      for (const v of seq) closest = Math.min(closest, dTo[v] ?? Infinity);
      if (closest <= 1) nearReached++;
      finalDistSum +=
        seq.length > 0 ? (dTo[seq[seq.length - 1]] ?? graphDist) : graphDist;
      if (seq.length >= 2) {
        pathProducing++;
        let dec = 0;
        for (let k = 0; k + 1 < seq.length; k++)
          if (dTo[seq[k + 1]] < dTo[seq[k]]) dec++;
        monoSum += dec / (seq.length - 1);
        for (const v of seq) {
          if (v === srcNode || v === tgtNode) continue;
          interiorTotal++;
          if (dFrom[v] + dTo[v] === graphDist) onPathHits++;
        }
      }
    }
    return {
      pairs: pairs.length,
      reachRate: reached / pairs.length,
      nearReachRate: nearReached / pairs.length,
      monotonicity: pathProducing > 0 ? monoSum / pathProducing : 0,
      onPathRate: interiorTotal > 0 ? onPathHits / interiorTotal : 0,
      meanWalkLen: walkLenSum / pairs.length,
      meanFinalDist: finalDistSum / pairs.length,
    };
  }

  // Self-calibrating scorer: no λ argument - settleAdaptive picks it per pair.
  function scoreAdaptive(): DirectedReport & {
    meanLambda: number;
    meanEsc: number;
  } {
    let reached = 0,
      nearReached = 0,
      finalDistSum = 0,
      pathProducing = 0,
      monoSum = 0,
      walkLenSum = 0,
      onPathHits = 0,
      interiorTotal = 0,
      lambdaSum = 0,
      escSum = 0;
    for (const [srcNode, tgtNode, graphDist] of pairs) {
      const dFrom = bfsHopDistances(srcNode, adj);
      const dTo = bfsHopDistances(tgtNode, adj);
      const {
        walk: seq,
        lambda,
        escalations,
      } = settleAdaptive(nodeToP[srcNode], nodeToP[tgtNode]);
      lambdaSum += lambda;
      escSum += escalations;
      walkLenSum += seq.length;
      if (seq.includes(tgtNode)) reached++;
      let closest = Infinity;
      for (const v of seq) closest = Math.min(closest, dTo[v] ?? Infinity);
      if (closest <= 1) nearReached++;
      finalDistSum +=
        seq.length > 0 ? (dTo[seq[seq.length - 1]] ?? graphDist) : graphDist;
      if (seq.length >= 2) {
        pathProducing++;
        let dec = 0;
        for (let k = 0; k + 1 < seq.length; k++)
          if (dTo[seq[k + 1]] < dTo[seq[k]]) dec++;
        monoSum += dec / (seq.length - 1);
        for (const v of seq) {
          if (v === srcNode || v === tgtNode) continue;
          interiorTotal++;
          if (dFrom[v] + dTo[v] === graphDist) onPathHits++;
        }
      }
    }
    return {
      pairs: pairs.length,
      reachRate: reached / pairs.length,
      nearReachRate: nearReached / pairs.length,
      monotonicity: pathProducing > 0 ? monoSum / pathProducing : 0,
      onPathRate: interiorTotal > 0 ? onPathHits / interiorTotal : 0,
      meanWalkLen: walkLenSum / pairs.length,
      meanFinalDist: finalDistSum / pairs.length,
      meanLambda: lambdaSum / pairs.length,
      meanEsc: escSum / pairs.length,
    };
  }

  const fmtRow = (tag: string, r: DirectedReport) =>
    `${tag.padStart(9)}  ${(r.reachRate * 100).toFixed(0).padStart(5)}%  ` +
    `${(r.nearReachRate * 100).toFixed(0).padStart(4)}%  ${r.meanFinalDist.toFixed(2).padStart(6)}  ` +
    `${r.onPathRate.toFixed(3).padStart(7)}  ${r.monotonicity.toFixed(3).padStart(8)}  ` +
    `${r.meanWalkLen.toFixed(1).padStart(7)}`;

  rebuild();
  console.log(
    `\nDirected settling fidelity (conformal OFF, ${pairs.length} far pairs)\n`
  );
  console.log(
    `${"λ (goal)".padStart(9)}  ${"reach".padStart(6)}  ${"near".padStart(5)}  ${"finalD".padStart(6)}  ${"onPath".padStart(7)}  ${"monotone".padStart(8)}  ${"walkLen".padStart(7)}`
  );
  for (const lambda of [0, 0.05, 0.2, 0.5, 1.0, 4.0, 8.0, 16.0, 64.0]) {
    console.log(fmtRow(lambda.toFixed(2), score(lambda)));
  }
  // Self-calibrating row: escalate-until-arrival picks λ per pair, no constant.
  const adapt = scoreAdaptive();
  console.log(
    fmtRow("adaptive", adapt) +
      `   (⟨λ⟩=${adapt.meanLambda.toFixed(1)}, ⟨esc⟩=${adapt.meanEsc.toFixed(1)})`
  );

  // --- Scale-invariance via a SELF-SIMILAR transform: positions ×s, falloff
  // F ×s², radius-cutoff ×s². The field is geometrically identical but its force
  // magnitude scales ×(1/s), so the faithful goal-bias λ* scales ×(1/s²). At s=2
  // the hand-tuned λ=16 is now 4× too strong → it beelines (onPath collapses);
  // the self-calibrator just escalates to a different λ* (≈4) and stays at the
  // faithful peak. THIS is the case a hardcoded constant cannot survive.
  const physS = DOPAT_CONFIG.PHYSICS as {
    INFLUENCE_FALLOFF: number;
    INFLUENCE_RADIUS: number;
  };
  const s = 2;
  const F0 = physS.INFLUENCE_FALLOFF,
    R0 = physS.INFLUENCE_RADIUS;
  const posSnap = allocated.map(id => ({
    x: system.posX[id],
    y: system.posY[id],
    z: system.posZ[id],
    w: system.posW[id],
  }));
  for (const id of allocated) {
    system.posX[id] *= s;
    system.posY[id] *= s;
    system.posZ[id] *= s;
    system.posW[id] *= s;
  }
  physS.INFLUENCE_FALLOFF = F0 * s * s;
  physS.INFLUENCE_RADIUS = R0 * s * s;
  if (system.version !== undefined) (system as any).version++;
  rebuild();
  console.log(`\n  self-similar scale s=${s} (λ* expected ×1/${s * s} ⇒ ≈4):`);
  console.log(fmtRow("λ=16", score(16)));
  const adaptS = scoreAdaptive();
  console.log(
    fmtRow("adaptive", adaptS) +
      `   (⟨λ⟩=${adaptS.meanLambda.toFixed(1)}, ⟨esc⟩=${adaptS.meanEsc.toFixed(1)})`
  );
  physS.INFLUENCE_FALLOFF = F0;
  physS.INFLUENCE_RADIUS = R0;
  for (let i = 0; i < allocated.length; i++) {
    const id = allocated[i];
    system.posX[id] = posSnap[i].x;
    system.posY[id] = posSnap[i].y;
    system.posZ[id] = posSnap[i].z;
    system.posW[id] = posSnap[i].w;
  }
  if (system.version !== undefined) (system as any).version++;
  rebuild();

  // Position-shuffle null: destroy the faithful map, keep everything else.
  // A deterministic Fisher–Yates over a snapshot of the allocated positions.
  const snap = allocated.map(id => ({
    x: system.posX[id],
    y: system.posY[id],
    z: system.posZ[id],
    w: system.posW[id],
  }));
  let scl = 12345;
  const rnd = () => (scl = (scl * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  for (let i = snap.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [snap[i], snap[j]] = [snap[j], snap[i]];
  }
  for (let i = 0; i < allocated.length; i++) {
    const id = allocated[i];
    system.posX[id] = snap[i].x;
    system.posY[id] = snap[i].y;
    system.posZ[id] = snap[i].z;
    system.posW[id] = snap[i].w;
  }
  if (system.version !== undefined) (system as any).version++;
  rebuild();
  const nullR = score(0.2);
  console.log(
    `\n  shuffled-position null (λ=0.20): onPath ${nullR.onPathRate.toFixed(3)}, ` +
      `monotone ${nullR.monotonicity.toFixed(3)}, reach ${(nullR.reachRate * 100).toFixed(0)}%`
  );

  phys.CONFORMAL_ENABLED = true;
  console.log();
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
