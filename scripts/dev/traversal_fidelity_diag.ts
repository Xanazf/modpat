/**
 * Diagnostic: traversal fidelity of the raw geodesic on a grounded code graph.
 * Run: tsx scripts/dev/traversal_fidelity_diag.ts
 *
 * Grounds a sample TS file into a live System (P1's faithful map), then measures
 * whether Traveler.traverse(source, target) produces paths that track the graph
 * geodesic. Compares the faithful placement against a shuffled-coordinate null.
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import Store from "@core_s/Memory";
import { metrics } from "@core_s/Metrics";
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

function shutdown(engine: Engine): void {
  engine.validate();
}
`;

function show(label: string, r: Grounding.TraversalFidelityReport): void {
  console.log(
    `  ${label.padEnd(12)} pairs=${r.pairs}  reach=${r.reachRate.toFixed(2)}  ` +
      `monotonic=${r.monotonicity.toFixed(2)}  onPath=${r.onPathRate.toFixed(2)}  ` +
      `pathRate=${r.pathRate.toFixed(2)}  meanNodes=${r.meanGraphNodes.toFixed(2)}`
  );
}

async function main(): Promise<void> {
  seedRandom(0);
  const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
    includeCallSites: true,
  });

  // Faithful (structure-grounded) placement.
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const { graph, nodeToPrecept } = groundAstIntoSystem(
    triples,
    system,
    atomizer,
    { seed: 0 }
  );
  const traveler = new Traveler(system);
  const fStruct = await traversalFidelity(
    graph,
    nodeToPrecept,
    (s, t) => traveler.traverse(s, t),
    { maxPairs: 48 }
  );

  // Shuffled-coordinate null: same precepts, random positions.
  const nullSystem = new System();
  const nullAtomizer = new LogicAtomizer();
  await nullAtomizer.init();
  const { graph: g2, nodeToPrecept: n2p } = groundAstIntoSystem(
    triples,
    nullSystem,
    nullAtomizer,
    { seed: 0 }
  );
  const spread = 200;
  for (let i = 0; i < g2.nodes.length; i++) {
    const id = n2p[i];
    if (id < 0) continue;
    nullSystem.posX[id] = (random() - 0.5) * spread;
    nullSystem.posY[id] = (random() - 0.5) * spread;
    nullSystem.posZ[id] = (random() - 0.5) * spread;
    nullSystem.posW[id] = random() * spread * 0.01;
    nullSystem.update(id);
  }
  const nullTraveler = new Traveler(nullSystem);
  const fNull = await traversalFidelity(
    g2,
    n2p,
    (s, t) => nullTraveler.traverse(s, t),
    { maxPairs: 48 }
  );

  console.log(
    "\nTraversal fidelity - raw geodesic over a grounded code graph\n"
  );
  show("structural", fStruct);
  show("shuffled", fNull);

  // -- Do REAL queries (full perceive pipeline) actually run the geodesic? ----
  // Multi-symbol code queries fall through every logic fast-path (not
  // arithmetic / syllogism / fuzzy / Sink-terminated), so they reach the
  // settle→source/sink→traverse path. Count how many fire the geodesic vs the
  // mass-ranked cluster fallback.
  metrics.reset();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();
  const perceiver = new Traveler(system, atomizer, store);
  const allocated: number[] = [];
  for (let i = 0; i < graph.nodes.length; i++) {
    const id = nodeToPrecept[i];
    if (id >= 0) allocated.push(id);
  }
  let queries = 0;
  for (let i = 0; i < allocated.length && queries < 40; i++) {
    for (let j = i + 1; j < allocated.length && queries < 40; j += 3) {
      await perceiver.perceiveCoherent(
        new Uint32Array([allocated[i], allocated[j]])
      );
      queries++;
    }
  }
  await store.close();
  const snap = metrics.getSnapshot();
  const geo = snap["perception.geodesic"]?.value ?? 0;
  const fallback = snap["perception.cluster_fallback"]?.value ?? 0;
  const collapsed = snap["perception.source_collapsed"]?.value ?? 0;
  console.log(
    `\nReal queries via perceiveCoherent (${queries} fall-through code queries):`
  );
  console.log(
    `  perception.geodesic=${geo}  perception.cluster_fallback=${fallback}  ` +
      `geodesic-run-rate=${((geo / Math.max(1, geo + fallback)) * 100).toFixed(0)}%`
  );
  console.log(
    `  source-collapsed (would have hit the salad fallback pre-fix): ${collapsed}/${queries}` +
      ` → recovered to a distinct source so the geodesic runs`
  );
  console.log();
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
