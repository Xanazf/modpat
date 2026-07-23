/**
 * P2 repair-operator measurement (roadmap intermediate-step 1).
 *
 * The gate spec is repair-then-abstain: on incoherence, attempt one terrain
 * repair and emit if the result becomes coherent. The deferral condition was
 * "a repair operator with measured payoff" - this script IS the measurement.
 *
 * For every calibration case where the gate abstains, three candidate repairs
 * are attempted and their outcome gated again:
 *   R1 probe re-traverse  - re-run perception in probeMode (physics-only walk,
 *                           no fast paths): does the terrain itself support a
 *                           coherent answer the fast paths missed?
 *   R2 reinforce + retry  - boost the input atoms' masses (local terrain
 *                           reinforcement, the cheap unfold analogue), rebuild
 *                           the grid, re-perceive.
 *   R3 plain re-perceive  - run the normal pipeline a second time (the first
 *                           attempt's settling/crystallization side-effects
 *                           are now part of the terrain).
 *
 * Payoff = correct flips − wrong flips. A repair "pays" only if it converts
 * abstentions into CORRECT emissions without converting any into wrong ones.
 *
 * Run: tsx scripts/dev/repair_operator_diag.ts
 */

import { gpu_math } from "@_lib/math/TensorMath";
import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";
import { gateEmit } from "@skill_cogi/Coherence";

(DOPAT_CONFIG as { USE_GPU: boolean }).USE_GPU = false;

interface Case {
  id: string;
  source: string;
  expected: string; // "" = no valid answer exists (a flip to ANY emit is wrong)
}

// The calibration corpus (kept in sync with tests/benchmarks/coherence_calibration.ts).
const CASES: Case[] = [
  { id: "trans2", source: "a is b && b is c |-", expected: "c" },
  { id: "trans3", source: "a is b && b is c && c is d |-", expected: "d" },
  {
    id: "mp1",
    source: "if it rains then the ground is wet. it rains. the ground |-",
    expected: "wet",
  },
  { id: "mp2", source: "if p then q. p is true. q |-", expected: "true" },
  {
    id: "syll1",
    source: "all birds are animals. tweety is a bird. tweety |-",
    expected: "animal",
  },
  {
    id: "disj1",
    source: "either the cat is inside or the cat is outside. the cat |-",
    expected: "",
  },
  {
    id: "disj2",
    source:
      "either the cat is inside or the cat is outside. the cat is not outside. the cat |-",
    expected: "inside",
  },
  {
    id: "neg1",
    source: "cats are not fish. felix is a cat. felix |-",
    expected: "fish",
  },
  { id: "arith1", source: "3 + 4 |-", expected: "7" },
  { id: "conj1", source: "a is b && x is y |-", expected: "b" },
  { id: "broken1", source: "blorf glik vex |-", expected: "" },
  { id: "broken2", source: "a is b. x is y. zock |-", expected: "" },
];

interface Attempt {
  emitted: boolean;
  answer: string;
  correct: boolean;
}

async function gatedAttempt(
  traveler: Traveler,
  system: System,
  atomizer: LogicAtomizer,
  ids: Uint32Array,
  expected: string,
  opts: { probeMode?: boolean } = {}
): Promise<Attempt> {
  const resultIds = await traveler.perceive(ids, opts);
  const answer = atomizer
    .decodeSequence(resultIds, system)
    .toLowerCase()
    .trim();
  const grid = new GridIndex4D();
  grid.buildFromSystem(system);
  const verdict = gateEmit(
    ids,
    resultIds,
    system,
    grid,
    traveler.lastInferentialEffort,
    { ruleDerived: traveler.lastProvenance !== "cluster" }
  );
  const tokenCount = answer.split(/\s+/).filter(Boolean).length;
  const correct =
    expected !== "" && answer.includes(expected) && tokenCount <= 4;
  const emitted = verdict.emit && answer !== "unknown" && answer !== "";
  return { emitted, answer, correct };
}

async function run(): Promise<void> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();

  const tally = {
    abstains: 0,
    repairs: {
      probe: { correctFlip: 0, wrongFlip: 0 },
      reinforce: { correctFlip: 0, wrongFlip: 0 },
      retry: { correctFlip: 0, wrongFlip: 0 },
    },
  };

  for (const c of CASES) {
    system.reset();
    const base = new Traveler(system, atomizer, store);
    const traveler = createTestTraveler(system, atomizer, base, store);
    traveler.setGPUEnabled(false);

    const ids = atomizer.ingestSequence(c.source, system);
    const first = await gatedAttempt(
      traveler,
      system,
      atomizer,
      ids,
      c.expected
    );
    if (first.emitted) continue; // the gate emitted; repair is not in play

    tally.abstains++;
    console.log(
      `[${c.id.padEnd(8)}] ABSTAIN (ans="${first.answer.slice(0, 28)}", ` +
        `want "${c.expected || "(none)"}") - trying repairs:`
    );

    const repairs: Array<[keyof typeof tally.repairs, () => Promise<Attempt>]> =
      [
        [
          "probe",
          () =>
            gatedAttempt(traveler, system, atomizer, ids, c.expected, {
              probeMode: true,
            }),
        ],
        [
          "reinforce",
          async () => {
            (
              traveler as unknown as {
                boostAtomMasses(ids: Uint32Array): void;
              }
            ).boostAtomMasses(ids);
            return gatedAttempt(traveler, system, atomizer, ids, c.expected);
          },
        ],
        [
          "retry",
          () => gatedAttempt(traveler, system, atomizer, ids, c.expected),
        ],
      ];

    for (const [name, fn] of repairs) {
      const r = await fn();
      const flip = r.emitted
        ? r.correct
          ? "CORRECT-FLIP"
          : "WRONG-FLIP"
        : "no flip";
      if (r.emitted && r.correct) tally.repairs[name].correctFlip++;
      if (r.emitted && !r.correct) tally.repairs[name].wrongFlip++;
      console.log(
        `    ${String(name).padEnd(9)} -> ${flip.padEnd(12)} ans="${r.answer.slice(0, 28)}"`
      );
    }
  }

  await store.close();

  console.log("\n================ REPAIR PAYOFF ================");
  console.log(`gate abstains measured: ${tally.abstains}`);
  for (const [name, t] of Object.entries(tally.repairs)) {
    const payoff = t.correctFlip - t.wrongFlip;
    console.log(
      `${name.padEnd(9)} correct-flips=${t.correctFlip} wrong-flips=${t.wrongFlip} ` +
        `payoff=${payoff} ${payoff > 0 ? "<- PAYS, wire it" : "(does not pay)"}`
    );
  }
}

run()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await gpu_math.dispose?.().catch(() => {});
    process.exit(process.exitCode ?? 0);
  });
