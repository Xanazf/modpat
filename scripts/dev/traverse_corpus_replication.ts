/**
 * Cross-corpus replication: does directed settling beat relaxPath across MANY
 * grounded corpora, or was the single-fixture win (incr-10) an artifact?
 * Run: tsx scripts/dev/traverse_corpus_replication.ts
 *
 * Runs the exact incr-10 comparison - Traveler.traverse (relaxPath BVP) vs
 * Traveler.settleTraverse (directed settling IVP), both scored by
 * traversalFidelity against the graph geodesic - over a battery of corpora with
 * deliberately different topologies (linear chain, fan-out, diamond hierarchy,
 * the original sample) plus several REAL repo files. A per-corpus PASS requires
 * settling to improve BOTH reach and onPath; replication holds only if the gap
 * is consistent, not corpus-specific.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
import { traversalFidelity } from "@core_s/grounding/TraversalFidelity";
import { extractAstTriples } from "@utils/astExtract";
import { seedRandom } from "@utils/seededRandom";

const SYNTHETIC: Array<{ name: string; source: string }> = [
  {
    name: "sample (orig)",
    source: `
interface Result { code: number; message: string; }
class Engine {
  start(): Result { return this.boot(); }
  boot(): Result { return this.validate(); }
  validate(): Result { return { code: 0, message: "ok" }; }
}
class Logger { write(l: string): void {} flush(): void { this.write("f"); } }
function bootstrap(e: Engine, l: Logger): Result {
  l.write("s"); const r = e.start(); l.flush(); return r;
}
function shutdown(e: Engine): void { e.validate(); }`,
  },
  {
    name: "linear chain",
    source: `
function a(): number { return b(); }
function b(): number { return c(); }
function c(): number { return d(); }
function d(): number { return e(); }
function e(): number { return f(); }
function f(): number { return g(); }
function g(): number { return 0; }`,
  },
  {
    name: "fan-out hub",
    source: `
function leaf1(): number { return 1; }
function leaf2(): number { return 2; }
function leaf3(): number { return 3; }
function leaf4(): number { return 4; }
function leaf5(): number { return 5; }
function leaf6(): number { return 6; }
function hub(): number {
  return leaf1() + leaf2() + leaf3() + leaf4() + leaf5() + leaf6();
}
function driver(): number { return hub(); }`,
  },
  {
    name: "diamond hier.",
    source: `
class Base { init(): void { this.setup(); } setup(): void {} }
class Left extends Base { run(): void { this.init(); this.work(); } work(): void {} }
class Right extends Base { run(): void { this.init(); this.task(); } task(): void {} }
class Join {
  l: Left; r: Right;
  go(): void { this.l.run(); this.r.run(); this.merge(); }
  merge(): void {}
}
function main(j: Join): void { j.go(); }`,
  },
];

const REAL_FILES = [
  "src/_lib/soa/GridIndex4D.ts",
  "src/core/structural/grounding/GroundGraph.ts",
  "src/core/structural/grounding/TraversalFidelity.ts",
  "src/core/structural/grounding/MapFidelity.ts",
  "src/core/integral/skills/cognition/Coherence.ts",
];

interface Row {
  name: string;
  pairs: number;
  relax: Grounding.TraversalFidelityReport;
  settle: Grounding.TraversalFidelityReport;
}

async function scoreCorpus(
  name: string,
  source: string,
  filePath: string,
  maxPairs: number
): Promise<Row | null> {
  const triples = extractAstTriples(source, filePath, {
    includeCallSites: true,
  });
  if (triples.length === 0) return null;
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
  const traveler = new Traveler(system);
  const relax = await traversalFidelity(
    graph,
    nodeToPrecept,
    (s, t) => traveler.traverse(s, t),
    { maxPairs }
  );
  if (relax.pairs < 4) return null; // too sparse to be meaningful
  const settle = await traversalFidelity(
    graph,
    nodeToPrecept,
    (s, t) => traveler.settleTraverse(s, t),
    { maxPairs }
  );
  return { name, pairs: relax.pairs, relax, settle };
}

function printRow(r: Row): boolean {
  const dReach = r.settle.reachRate - r.relax.reachRate;
  const dOn = r.settle.onPathRate - r.relax.onPathRate;
  const pass = dOn > 0.02 && dReach >= -0.02; // settle must improve onPath, not regress reach
  console.log(
    `  ${r.name.padEnd(15)} n=${String(r.pairs).padStart(3)}  ` +
      `relax[reach=${r.relax.reachRate.toFixed(2)} onPath=${r.relax.onPathRate.toFixed(3)}]  ` +
      `settle[reach=${r.settle.reachRate.toFixed(2)} onPath=${r.settle.onPathRate.toFixed(3)}]  ` +
      `Δreach=${(dReach >= 0 ? "+" : "") + dReach.toFixed(2)} Δon=${(dOn >= 0 ? "+" : "") + dOn.toFixed(3)}  ` +
      `${pass ? "PASS" : "----"}`
  );
  return pass;
}

async function main(): Promise<void> {
  (DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;
  seedRandom(0);
  console.log(
    "\nCross-corpus replication: settling (IVP) vs relaxPath (BVP)\n"
  );

  const rows: Row[] = [];
  for (const c of SYNTHETIC) {
    const r = await scoreCorpus(c.name, c.source, `${c.name}.ts`, 64);
    if (r) rows.push(r);
  }
  for (const rel of REAL_FILES) {
    let src: string;
    try {
      src = readFileSync(resolve(process.cwd(), rel), "utf8");
    } catch {
      continue;
    }
    const short = rel.split("/").pop() ?? rel;
    const r = await scoreCorpus(short, src, rel, 80);
    if (r) rows.push(r);
  }

  console.log("synthetic + real corpora:");
  let passes = 0;
  let sumDOn = 0;
  let sumDReach = 0;
  for (const r of rows) {
    if (printRow(r)) passes++;
    sumDOn += r.settle.onPathRate - r.relax.onPathRate;
    sumDReach += r.settle.reachRate - r.relax.reachRate;
  }
  console.log(
    `\n  ${passes}/${rows.length} corpora PASS  ` +
      `(mean Δreach=${(sumDReach / rows.length >= 0 ? "+" : "") + (sumDReach / rows.length).toFixed(3)}, ` +
      `mean Δonpath=${(sumDOn / rows.length >= 0 ? "+" : "") + (sumDOn / rows.length).toFixed(3)})`
  );
  console.log();
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
