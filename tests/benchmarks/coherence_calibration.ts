/**
 * Phase 2 calibration - does the coherence score track correctness?
 * Run: tsx tests/benchmarks/coherence_calibration.ts
 *
 * Runs labelled logic queries through the live perceive pipeline, scores each
 * resolved traversal with pathCoherence, and reports:
 *   - whether CORRECT answers score higher than WRONG ones,
 *   - the threshold that best separates them,
 *   - and crucially, any WRONG-BUT-COHERENT case (high score, wrong answer) -
 *     which would mean the gate alone cannot deliver "never emit a wrong answer".
 *
 * Each case runs on a freshly reset manifold with a fresh Traveler, so the
 * inferential-effort signal reflects that query's traversal only.
 */

import { gpu_math } from "@_lib/math/TensorMath";
import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";
import { gateEmit, pathCoherence } from "@skill_cogi/Coherence";

// CPU-only harness; the GPU device otherwise keeps the process alive past the run.
(DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;

interface Case {
  id: string;
  source: string;
  /** Expected substring; "" means there is no valid answer (broken/contradiction). */
  expected: string;
  /** Rough class for reporting. */
  kind:
    | "transitive"
    | "modus_ponens"
    | "syllogism"
    | "connective"
    | "arithmetic"
    | "broken";
}

const CASES: Case[] = [
  {
    id: "trans2",
    source: "a is b && b is c |-",
    expected: "c",
    kind: "transitive",
  },
  {
    id: "trans3",
    source: "a is b && b is c && c is d |-",
    expected: "d",
    kind: "transitive",
  },
  {
    id: "trans4",
    source: "p is q && q is r && r is s && s is t |-",
    expected: "t",
    kind: "transitive",
  },
  {
    id: "trans5",
    source: "p is q && q is r && r is s && s is t && t is u |-",
    expected: "u",
    kind: "transitive",
  },
  {
    id: "mp1",
    source: "if it rains then the ground is wet. it rains. the ground |-",
    expected: "wet",
    kind: "modus_ponens",
  },
  {
    id: "mp2",
    source: "if p then q. p is true. q |-",
    expected: "true",
    kind: "modus_ponens",
  },
  {
    id: "syll1",
    source: "all birds are animals. tweety is a bird. tweety |-",
    expected: "animal",
    kind: "syllogism",
  },
  {
    id: "syll2",
    source: "all dogs are mammals. rex is a dog. rex |-",
    expected: "mammal",
    kind: "syllogism",
  },
  {
    // A bare alternation licenses no pick - the correct behaviour is abstain.
    id: "disj1",
    source: "either the cat is inside or the cat is outside. the cat |-",
    expected: "",
    kind: "connective",
  },
  {
    // Disjunctive syllogism: refuting one disjunct derives the other.
    id: "disj2",
    source:
      "either the cat is inside or the cat is outside. the cat is not outside. the cat |-",
    expected: "inside",
    kind: "connective",
  },
  {
    id: "neg1",
    source: "cats are not fish. felix is a cat. felix |-",
    expected: "fish",
    kind: "connective",
  },
  { id: "arith1", source: "3 + 4 |-", expected: "7", kind: "arithmetic" },
  { id: "arith2", source: "9 - 2 |-", expected: "7", kind: "arithmetic" },
  {
    // Two unrelated facts: no transitive chain exists, but conjunction
    // elimination (A ∧ B ⊢ A, the rule that fixed R4/R5) validly yields the
    // first conjunct's predicate. Relabelled 2026-06-12: the original
    // expected="" predates the conjunction-elimination rule and contradicted
    // the propositional suite's R4 (identical query shape, expected "black").
    id: "conj1",
    source: "a is b && x is y |-",
    expected: "b",
    kind: "connective",
  },
  {
    id: "conj2",
    source: "m is n && o is p && q is r |-",
    expected: "n",
    kind: "connective",
  },
  {
    // Genuinely broken: no copula, no operator, no rule can touch it. The
    // cluster fallback's fluent echo is the failure mode the gate must catch.
    id: "broken1",
    source: "blorf glik vex |-",
    expected: "",
    kind: "broken",
  },
  {
    // Query subject unrelated to every premise: nothing supports any answer.
    id: "broken2",
    source: "a is b. x is y. zock |-",
    expected: "",
    kind: "broken",
  },
];

interface Row {
  id: string;
  kind: string;
  correct: boolean;
  answer: string;
  score: number;
  effort: number;
  curv: number;
  sing: number;
  traversed: boolean;
  gateEmit: boolean;
  gateReason: string;
  echoFrac: number;
}

async function run(): Promise<void> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();

  const rows: Row[] = [];

  for (const c of CASES) {
    system.reset();
    const base = new Traveler(system, atomizer, store);
    const traveler = createTestTraveler(system, atomizer, base, store);
    traveler.setGPUEnabled(false);

    const ids = atomizer.ingestSequence(c.source, system);
    const resultIds = await traveler.perceive(ids, {});
    const answer = atomizer
      .decodeSequence(resultIds, system)
      .toLowerCase()
      .trim();
    // Honest-ish oracle: must contain the expected token AND be a concise
    // conclusion (<= 4 tokens), not a long echo of the premises. A genuine
    // reduction ("a is c") passes; a garbled premise-echo ("animals tweety a
    // bird tweety") does not. (Phase 3 reduction replaces this heuristic.)
    const tokenCount = answer.split(/\s+/).filter(Boolean).length;
    const correct =
      c.expected !== "" && answer.includes(c.expected) && tokenCount <= 4;

    const grid = new GridIndex4D();
    grid.buildFromSystem(system);
    const rep = pathCoherence(
      resultIds,
      system,
      grid,
      traveler.lastInferentialEffort
    );
    const verdict = gateEmit(
      ids,
      resultIds,
      system,
      grid,
      traveler.lastInferentialEffort,
      { ruleDerived: traveler.lastProvenance !== "cluster" }
    );

    rows.push({
      id: c.id,
      kind: c.kind,
      correct,
      answer,
      score: rep.score,
      effort: rep.inferentialEffort,
      curv: rep.meanCurvature,
      sing: rep.maxSingularity,
      traversed: rep.inferentialEffort > 1e-6,
      gateEmit: verdict.emit,
      gateReason: verdict.reason,
      echoFrac: verdict.echoFrac,
    });

    console.log(
      `[${c.id.padEnd(8)}] ${correct ? "OK  " : "WRONG"} ` +
        `score=${rep.score.toFixed(3)} eff=${rep.inferentialEffort.toFixed(3)} ` +
        `sing=${rep.maxSingularity.toFixed(2)} ` +
        `gate=${verdict.emit ? "EMIT" : "ABST"}(${verdict.reason},echo=${verdict.echoFrac.toFixed(2)}) ` +
        `ans="${answer.slice(0, 28)}" (want "${c.expected || "(none)"}")`
    );
  }

  await store.close();

  const good = rows.filter(r => r.correct);
  const wrong = rows.filter(r => !r.correct);
  const mean = (a: Row[]) =>
    a.length ? a.reduce((s, r) => s + r.score, 0) / a.length : NaN;
  const min = (a: Row[]) => (a.length ? Math.min(...a.map(r => r.score)) : NaN);
  const max = (a: Row[]) => (a.length ? Math.max(...a.map(r => r.score)) : NaN);

  console.log("\n================ CALIBRATION ================");
  console.log(
    `correct (n=${good.length}): score mean=${mean(good).toFixed(3)} ` +
      `min=${min(good).toFixed(3)} max=${max(good).toFixed(3)}`
  );
  console.log(
    `wrong   (n=${wrong.length}): score mean=${mean(wrong).toFixed(3)} ` +
      `min=${min(wrong).toFixed(3)} max=${max(wrong).toFixed(3)}`
  );
  console.log(
    `traversed (geodesic ran): ${rows.filter(r => r.traversed).length}/${rows.length}` +
      `  (coherence's effort signal is only meaningful for these)`
  );

  // Best separating threshold by balanced accuracy.
  let bestT = 0;
  let bestAcc = -1;
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const tp = good.filter(r => r.score >= t).length;
    const tn = wrong.filter(r => r.score < t).length;
    const acc =
      (good.length ? tp / good.length : 1) / 2 +
      (wrong.length ? tn / wrong.length : 1) / 2;
    if (acc > bestAcc) {
      bestAcc = acc;
      bestT = t;
    }
  }
  console.log(
    `best threshold=${bestT.toFixed(2)} balanced-accuracy=${(bestAcc * 100).toFixed(1)}%`
  );

  // The dangerous quadrant: wrong answers that still score "coherent".
  const wrongButCoherent = wrong.filter(r => r.score >= bestT);
  console.log(
    `WRONG-BUT-COHERENT @${bestT.toFixed(2)}: ${wrongButCoherent.length}` +
      (wrongButCoherent.length
        ? ` -> ${wrongButCoherent.map(r => `${r.id}(${r.score.toFixed(2)})`).join(", ")}`
        : " (none - score alone catches every wrong answer)")
  );

  // Now the live gate: combines coherence + anti-echo. This is what Phase 2
  // would actually emit through. Goal: gate-emit ≡ correct.
  const gateTP = good.filter(r => r.gateEmit).length;
  const gateTN = wrong.filter(r => !r.gateEmit).length;
  const gateFP = wrong.filter(r => r.gateEmit).length;
  const gateFN = good.filter(r => !r.gateEmit).length;
  const gateBal =
    (good.length ? gateTP / good.length : 1) / 2 +
    (wrong.length ? gateTN / wrong.length : 1) / 2;
  console.log(
    `gate: emit-correct=${gateTP}/${good.length}  abstain-wrong=${gateTN}/${wrong.length}  ` +
      `balanced-accuracy=${(gateBal * 100).toFixed(1)}%`
  );
  if (gateFP > 0) {
    console.log(
      `gate FALSE-EMITs (wrong answer escapes the gate): ${
        wrong
          .filter(r => r.gateEmit)
          .map(r => `${r.id}(echo=${r.echoFrac.toFixed(2)})`)
          .join(", ") || "(none)"
      }`
    );
  }
  if (gateFN > 0) {
    console.log(
      `gate OVER-ABSTAINs (correct answer gated out): ${
        good
          .filter(r => !r.gateEmit)
          .map(r => `${r.id}(${r.gateReason})`)
          .join(", ") || "(none)"
      }`
    );
  }
}

run()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (gpu_math.dispose) await gpu_math.dispose().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
