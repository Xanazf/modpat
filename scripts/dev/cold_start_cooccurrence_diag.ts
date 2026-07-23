/**
 * Phase 5 - cold-start co-occurrence grounding diagnostic.
 *
 * The referent channel (coordinate_migration_diag) only grounds a word that
 * NAMES an already-grounded symbol. The remaining open Phase-5 case is the
 * *cold start*: a word seen for the first time, with no referent of its own.
 * Legacy behaviour drops it at its GloVe co-occurrence coordinate - off the
 * faithful map. The claim under test: grounding a cold-start token toward the
 * grounded positions of the symbols it is *uttered alongside* lands it in their
 * structural neighbourhood instead.
 *
 * Method: ground a TS corpus into a System (StructuralGrounding/SMACOF, no
 * embeddings). Then, for each grounded single-word symbol S (grounded posX gx),
 * ingest a synthetic two-token utterance "<novel> S" AS LANGUAGE, where <novel>
 * is a never-before-seen token. Read where <novel>'s atom lands on posX.
 *   OFF - COLD_START_COOCCURRENCE_ENABLED=false: novel posX = GloVe(novel).
 *   ON  - COLD_START_COOCCURRENCE_ENABLED=true:  novel posX = mean referent posX
 *         of its co-occurring scopes = gx (its only grounded neighbour is S).
 *
 * Metrics (per mode):
 *   - locality hit-rate: fraction of novel words landing on the grounded
 *     neighbour (|novel - gx| < 1e-6).
 *   - mean |novelPosX - gx|: distance from the structural neighbourhood (ON ~0;
 *     OFF is the GloVe gap).
 * Plus an isolated-novel control (a novel word with NO grounded co-occurrent)
 * must land identically ON vs OFF - cold-start co-occurrence is behaviour-
 * preserving for a genuinely context-free first-seen word.
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import { groundAstIntoSystem } from "@core_s/grounding/AstGrounding";
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

function shutdown(engine: Engine): void {
  engine.validate();
}
`;

interface ModeResult {
  matchable: number;
  hits: number;
  meanDist: number;
}

let novelCounter = 0;
/** A token guaranteed never to have been registered (no GloVe entry, no referent). */
function freshNovel(): string {
  // Pure-consonant nonsense, monotonically unique per call.
  novelCounter++;
  return `qz${novelCounter}xv`;
}

async function build() {
  seedRandom(0);
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const triples = extractAstTriples(SAMPLE_SOURCE, "sample.ts", {
    includeCallSites: true,
  });
  const { graph, nodeToPrecept } = groundAstIntoSystem(
    triples,
    system,
    atomizer,
    { seed: 0 }
  );
  return { system, atomizer, graph, nodeToPrecept };
}

async function runMode(coocEnabled: boolean): Promise<ModeResult> {
  DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = true;
  DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED = coocEnabled;
  const { system, atomizer, graph, nodeToPrecept } = await build();

  let matchable = 0;
  let hits = 0;
  let distSum = 0;
  for (let i = 0; i < graph.nodes.length; i++) {
    const label = graph.nodes[i].label.toLowerCase();
    if (!/^[a-z]+$/.test(label)) continue; // single-word symbol only
    const gx = system.posX[nodeToPrecept[i]];
    const novel = freshNovel();
    const ids = atomizer.ingestSequence(`${novel} ${label}`, system);
    if (ids.length !== 2) continue; // expect [novel, label]
    matchable++;
    const novelX = system.posX[ids[0]];
    const d = Math.abs(novelX - gx);
    distSum += d;
    if (d < 1e-6) hits++;
  }
  return { matchable, hits, meanDist: matchable > 0 ? distSum / matchable : 0 };
}

/**
 * Multi-neighbour case: a novel word uttered alongside SEVERAL grounded symbols
 * must land at their centroid (the mean referent posX), inside the spread of
 * those neighbours - a genuine structural neighbourhood, not a single point.
 */
async function multiNeighbour(): Promise<{
  novelX: number;
  centroid: number;
  spread: number;
} | null> {
  DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = true;
  DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED = true;
  const { system, atomizer, graph, nodeToPrecept } = await build();
  const want = ["bootstrap", "engine", "logger"];
  const gxs: number[] = [];
  for (const w of want) {
    const i = graph.nodes.findIndex(n => n.label.toLowerCase() === w);
    if (i < 0) return null;
    gxs.push(system.posX[nodeToPrecept[i]]);
  }
  const novel = freshNovel();
  const ids = atomizer.ingestSequence(`${novel} ${want.join(" ")}`, system);
  const novelX = system.posX[ids[0]];
  const centroid = gxs.reduce((a, b) => a + b, 0) / gxs.length;
  const spread = Math.max(...gxs) - Math.min(...gxs);
  return { novelX, centroid, spread };
}

/** Control: a novel word uttered ALONE must cold-start identically ON vs OFF. */
async function isolatedControl(): Promise<{ on: number; off: number }> {
  const measure = async (cooc: boolean) => {
    DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = true;
    DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED = cooc;
    const { system, atomizer } = await build();
    const ids = atomizer.ingestSequence("qzsolo0xv", system);
    return system.posX[ids[0]];
  };
  return { on: await measure(true), off: await measure(false) };
}

async function main() {
  const origRef = DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED;
  const origCooc = DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED;
  try {
    const off = await runMode(false);
    const on = await runMode(true);
    const multi = await multiNeighbour();
    const ctrl = await isolatedControl();

    const row = (label: string, r: ModeResult) =>
      `  ${label.padEnd(16)} locality-hit=${((r.hits / Math.max(1, r.matchable)) * 100).toFixed(0).padStart(3)}% ` +
      `(${r.hits}/${r.matchable})  mean|Δ to grounded neighbour|=${r.meanDist.toFixed(3)}`;

    console.log("\n=== Phase 5: cold-start co-occurrence grounding ===\n");
    console.log(
      "  A first-seen word uttered next to a grounded symbol - where does it land?\n"
    );
    console.log(row("OFF (GloVe)", off));
    console.log(row("ON (co-occur)", on));
    if (multi) {
      console.log(
        `\n  multi-neighbour (novel + 3 grounded symbols): novelX=${multi.novelX.toFixed(3)} ` +
          `centroid=${multi.centroid.toFixed(3)} (neighbour spread ${multi.spread.toFixed(1)}) -> ${
            Math.abs(multi.novelX - multi.centroid) < 1e-6
              ? "lands at the grounded centroid"
              : "OFF centroid (bug)"
          }`
      );
    }
    console.log(
      `\n  isolated-novel control (no grounded co-occurrent): ON=${ctrl.on.toFixed(3)} ` +
        `OFF=${ctrl.off.toFixed(3)} -> ${
          Math.abs(ctrl.on - ctrl.off) < 1e-9
            ? "IDENTICAL (behaviour-preserving)"
            : "DIVERGED (bug)"
        }`
    );
    console.log(
      `\n  Verdict: cold-start co-occurrence ${
        on.meanDist < off.meanDist && on.hits > off.hits
          ? "GROUNDS FIRST-SEEN WORDS INTO STRUCTURE"
          : "did NOT improve over GloVe"
      } ` +
        `(ON-dist ${on.meanDist.toFixed(3)} vs OFF-dist ${off.meanDist.toFixed(3)}).\n`
    );
  } finally {
    DOPAT_CONFIG.PHYSICS.REFERENT_GROUNDING_ENABLED = origRef;
    DOPAT_CONFIG.PHYSICS.COLD_START_COOCCURRENCE_ENABLED = origCooc;
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
