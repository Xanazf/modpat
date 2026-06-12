/**
 * Shadow comparison: directed settling vs relaxPath BVP on the SAME grounded
 * corpus, scored against the graph geodesic with TraversalFidelity.
 * Run: tsx scripts/dev/traverse_shadow_compare.ts
 *
 * The prototypes (directed_settling_proto.ts) proved directed settling is
 * reaching + faithful in isolation. This runs it through the PRODUCTION code
 * path - Traveler.settleTraverse → Locomotion.settleDirectedPath - against the
 * production relaxPath (Traveler.traverse) on the identical faithful map, so the
 * difference shown is the real mechanism difference, not a re-implementation.
 * Both are scored by the same metric; a shuffled-coordinate null bounds chance.
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
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
function shutdown(engine: Engine): void { engine.validate(); }
`;

function show(label: string, r: Grounding.TraversalFidelityReport): void {
  console.log(
    `  ${label.padEnd(16)} reach=${r.reachRate.toFixed(2)}  ` +
      `onPath=${r.onPathRate.toFixed(3)}  monotonic=${r.monotonicity.toFixed(3)}  ` +
      `pathRate=${r.pathRate.toFixed(2)}  meanNodes=${r.meanGraphNodes.toFixed(1)}`
  );
}

async function ground(shuffle: boolean) {
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
  if (shuffle) {
    // Destroy the faithful map: permute allocated atom positions.
    const ids: number[] = [];
    for (let n = 0; n < graph.nodes.length; n++)
      if (nodeToPrecept[n] >= 0) ids.push(nodeToPrecept[n]);
    const snap = ids.map(id => ({
      x: system.posX[id],
      y: system.posY[id],
      z: system.posZ[id],
      w: system.posW[id],
    }));
    for (let i = snap.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [snap[i], snap[j]] = [snap[j], snap[i]];
    }
    ids.forEach((id, i) => {
      system.posX[id] = snap[i].x;
      system.posY[id] = snap[i].y;
      system.posZ[id] = snap[i].z;
      system.posW[id] = snap[i].w;
    });
  }
  return { graph, nodeToPrecept, traveler: new Traveler(system) };
}

async function main(): Promise<void> {
  (DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;
  seedRandom(0);

  console.log(
    "\nTraversal mechanism comparison (grounded TS corpus, 48 pairs)\n"
  );

  const faithful = await ground(false);
  const relax = await traversalFidelity(
    faithful.graph,
    faithful.nodeToPrecept,
    (s, t) => faithful.traveler.traverse(s, t),
    { maxPairs: 48 }
  );
  const settle = await traversalFidelity(
    faithful.graph,
    faithful.nodeToPrecept,
    (s, t) => faithful.traveler.settleTraverse(s, t),
    { maxPairs: 48 }
  );

  const nullMap = await ground(true);
  const settleNull = await traversalFidelity(
    nullMap.graph,
    nullMap.nodeToPrecept,
    (s, t) => nullMap.traveler.settleTraverse(s, t),
    { maxPairs: 48 }
  );

  console.log("faithful map:");
  show("relaxPath (BVP)", relax);
  show("settling (IVP)", settle);
  console.log("shuffled null:");
  show("settling", settleNull);
  console.log();
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
