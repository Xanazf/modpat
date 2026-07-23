/**
 * Phase 4.5 - the influence of a SELF-supplied ground truth vs an authored KB.
 *
 * The survey loop is now wired into the live manifold (Traveler.runSurveyLoopTick
 * / learnCycle behind SURVEY_LOOP_ENABLED). This bench asks the question that
 * wiring raises: where terrain has drifted, how much faithfulness does each
 * ground-truth SOURCE restore, and at what authoring cost?
 *
 *   - SELF-supplied (arithmetic): the system invents its own checks over its
 *     number line and evaluates them for free. Unbounded supply, zero authoring,
 *     but it only reaches the exact/computable domain.
 *   - KB-supplied (closed-world): an authored taxonomy's consequences are the
 *     truth. It reaches relational terrain the self channel cannot, but every
 *     relation is authored.
 *
 * A manifold carrying BOTH a number line and a taxonomy is corrupted in BOTH
 * sub-domains, then repaired under four regimes (none / self / kb / both). The
 * table shows the two sources are COMPLEMENTARY, not competing: self restores the
 * exact domain for free; KB restores the relational domain at authoring cost;
 * neither reaches the other's terrain. A second experiment shows the self channel
 * holds the number line faithful across rounds of fresh drift, with no authoring.
 *
 * Run: tsx scripts/dev/survey_loop_influence_bench.ts
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import { groundGraphIntoSystem } from "@core_s/grounding/AstGrounding";
import { buildGraphFromLogic } from "@core_s/grounding/LogicGraph";
import {
  arithmeticFidelity,
  arithmeticSelfChannel,
  closedWorldKbChannel,
  closedWorldLiveFidelity,
  runSurveyTick,
} from "@core_s/grounding/SurveyLoopRunner";
import { NUMBER_LINE_SCALE } from "@skill_cogi/Reduction";

const NUMS = 13; // 0..12

const TAXONOMY = [
  "felix is a cat",
  "tom is a cat",
  "garfield is a cat",
  "cats are mammals",
  "rex is a dog",
  "fido is a dog",
  "dogs are mammals",
  "mammals are animals",
  "nemo is a fish",
  "goldie is a fish",
  "bubbles is a fish",
  "fish are animals",
  "robin is a bird",
  "tweety is a bird",
  "birds are animals",
];

interface Env {
  system: System;
  atomizer: LogicAtomizer;
  numerals: Map<number, number>;
  kbGraph: Grounding.GroundGraph;
  nodeToPrecept: Int32Array;
}

async function setup(): Promise<Env> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();

  // Number line 0..12.
  const numerals = new Map<number, number>();
  for (let n = 0; n < NUMS; n++) {
    const scope = atomizer.getSymbolScope(String(n), false);
    const id = system.createLocation(system.c, scope);
    system.posW[id] = n * NUMBER_LINE_SCALE;
    system.decayRate[id] = 0;
    system.update(id);
    numerals.set(n, id);
  }

  // Taxonomy, grounded through the same channel code uses.
  const kbGraph = buildGraphFromLogic(TAXONOMY);
  const grounded = groundGraphIntoSystem(kbGraph, system, atomizer, {
    seed: 1,
  });

  return {
    system,
    atomizer,
    numerals,
    kbGraph,
    nodeToPrecept: grounded.nodeToPrecept,
  };
}

function nodeIndex(g: Grounding.GroundGraph, label: string): number {
  return g.nodes.findIndex(nd => nd.label === label);
}

/** Drift three numerals off the line and mis-file two taxonomy terms. */
function corrupt(env: Env): void {
  const { system, numerals, kbGraph, nodeToPrecept } = env;
  // Number-line drift past the snap boundary (so reducts mispredict).
  system.posW[numerals.get(5)!] = 5.6 * NUMBER_LINE_SCALE;
  system.posW[numerals.get(8)!] = 7.4 * NUMBER_LINE_SCALE;
  system.posW[numerals.get(11)!] = 9.5 * NUMBER_LINE_SCALE;

  // Taxonomy mis-survey: nemo filed under cat, robin under dog.
  const misFile = (who: string, where: string) => {
    const wp = nodeToPrecept[nodeIndex(kbGraph, where)];
    const ip = nodeToPrecept[nodeIndex(kbGraph, who)];
    system.posX[ip] = system.posX[wp] + 0.01;
    system.posY[ip] = system.posY[wp] - 0.01;
    system.posZ[ip] = system.posZ[wp] + 0.01;
    system.update(ip);
  };
  misFile("nemo", "cat");
  misFile("robin", "dog");
}

function measure(env: Env): { arith: number; logic: number } {
  return {
    arith: arithmeticFidelity(env.system, env.atomizer, env.numerals),
    logic: closedWorldLiveFidelity(env.kbGraph, env.system, env.nodeToPrecept),
  };
}

function channelsFor(regime: string, env: Env): Grounding.GroundTruthChannel[] {
  const self = arithmeticSelfChannel({ numerals: env.numerals });
  const kb = closedWorldKbChannel(env.kbGraph, env.nodeToPrecept);
  if (regime === "self") return [self];
  if (regime === "kb") return [kb];
  if (regime === "both") return [self, kb];
  return [];
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + " ".repeat(n - s.length);
}

async function regimeTable(): Promise<void> {
  console.log("=== influence of ground-truth SOURCE on terrain repair ===\n");
  console.log(
    pad("regime", 8) +
      pad("arith", 16) +
      pad("logic", 16) +
      pad("repairs", 9) +
      pad("authored", 9) +
      "ms"
  );
  for (const regime of ["none", "self", "kb", "both"]) {
    const env = await setup();
    corrupt(env);
    const before = measure(env);
    const t0 = performance.now();
    const tick = runSurveyTick(
      env.system,
      env.atomizer,
      channelsFor(regime, env)
    );
    const ms = performance.now() - t0;
    const after = measure(env);
    const authored = tick.channels
      .filter(c => c.source === "kb")
      .reduce((s, c) => s + c.groundTruthUnits, 0);
    console.log(
      pad(regime, 8) +
        pad(`${before.arith.toFixed(2)}->${after.arith.toFixed(2)}`, 16) +
        pad(`${before.logic.toFixed(2)}->${after.logic.toFixed(2)}`, 16) +
        pad(String(tick.totalRepairs), 9) +
        pad(String(authored), 9) +
        ms.toFixed(0)
    );
  }
  console.log(
    "\n  self restores ARITH for free (authored=0) but never moves LOGIC;\n" +
      "  kb restores LOGIC at authoring cost but never moves ARITH;\n" +
      "  both restores the whole terrain - the sources are complementary."
  );
}

/** Continuous correction: fresh drift each round, self channel with vs without. */
async function continuousExperiment(): Promise<void> {
  console.log(
    "\n=== self-supplied continuous maintenance (no authoring) ===\n"
  );
  const rounds = 5;
  const driftSeq = [5, 8, 3, 11, 2];

  for (const withTick of [false, true]) {
    const env = await setup();
    const ch = [arithmeticSelfChannel({ numerals: env.numerals })];
    const traj: string[] = [];
    for (let r = 0; r < rounds; r++) {
      // A fresh numeral drifts past the snap boundary each round.
      const v = driftSeq[r % driftSeq.length];
      env.system.posW[env.numerals.get(v)!] = (v + 0.6) * NUMBER_LINE_SCALE;
      if (withTick) runSurveyTick(env.system, env.atomizer, ch);
      traj.push(measure(env).arith.toFixed(2));
    }
    console.log(
      `  ${withTick ? "with tick   " : "without tick"}: arith fidelity ${traj.join(" -> ")}`
    );
  }
  console.log(
    "\n  without authoring or supervision, the self channel pins the number\n" +
      "  line back to 1.0 every round; left alone, drift accumulates."
  );
}

async function run(): Promise<void> {
  await regimeTable();
  await continuousExperiment();
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
