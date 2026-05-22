/**
 * F2 - External benchmark scaffolding.
 * Run: tsx tests/benchmarks/external_benchmarks.ts
 *
 * Evaluates the engine against structured task families modelled after
 * RuleTaker, ProofWriter, and Logical NLI.  Results are appended to
 * tests/benchmarks/metric_ab.baseline.json under the "external" key.
 * CI exits with code 1 if any previously-passing task family regresses.
 *
 * Design notes:
 *   – Inline representative samples only; no external dataset files required.
 *   – Each family is independently scoreable so partial dataset coverage is fine.
 *   – The baseline file is the single regression surface (no separate file).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import Resolver from "@core_i/Resolver";
import System from "@core_i/System";
import { createTestMapper } from "@core_i/Runtime";
import type Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";

// ---------------------------------------------------------------------------
// Task families
// ---------------------------------------------------------------------------

interface TaskPair {
  id: string;
  /** Text fed to the engine. */
  source: string;
  /** Expected substring in the answer (empty string = don't-crash guard). */
  expected: string;
}

/**
 * RuleTaker-style: closed-world deduction over explicit facts.
 * Hop depth = how many chain links the engine must traverse.
 */
const RULETAKER: { hop: number; pairs: TaskPair[] }[] = [
  {
    hop: 1,
    pairs: [
      { id: "rt_h1_1", source: "a is b |-", expected: "b" },
      {
        id: "rt_h1_2",
        source: "cats are mammals. felix is a cat. felix |-",
        expected: "mammal",
      },
      {
        id: "rt_h1_3",
        source: "all dogs bark. rex is a dog. rex |-",
        expected: "bark",
      },
      { id: "rt_h1_4", source: "the sky is blue |-", expected: "blue" },
      {
        id: "rt_h1_5",
        source: "water boils at one hundred degrees. water |-",
        expected: "hundred",
      },
    ],
  },
  {
    hop: 2,
    pairs: [
      { id: "rt_h2_1", source: "a is b && b is c |-", expected: "c" },
      {
        id: "rt_h2_2",
        source:
          "dogs are mammals && mammals are animals. fido is a dog. fido |-",
        expected: "animal",
      },
      {
        id: "rt_h2_3",
        source: "p implies q && q implies r. p is true. r |-",
        expected: "true",
      },
      {
        id: "rt_h2_4",
        source: "iron is metal && metal conducts electricity. iron |-",
        expected: "electricity",
      },
    ],
  },
  {
    hop: 3,
    pairs: [
      { id: "rt_h3_1", source: "a is b && b is c && c is d |-", expected: "d" },
      {
        id: "rt_h3_2",
        source: "x is y && y is z && z is w. x |-",
        expected: "w",
      },
      {
        id: "rt_h3_3",
        source:
          "roses are flowers && flowers are plants && plants are organisms. roses |-",
        expected: "organism",
      },
    ],
  },
  {
    hop: 4,
    pairs: [
      {
        id: "rt_h4_1",
        source: "p is q && q is r && r is s && s is t |-",
        expected: "t",
      },
      {
        id: "rt_h4_2",
        source: "a is b && b is c && c is d && d is e |-",
        expected: "e",
      },
    ],
  },
  {
    hop: 5,
    pairs: [
      {
        id: "rt_h5_1",
        source: "p is q && q is r && r is s && s is t && t is u |-",
        expected: "u",
      },
      {
        id: "rt_h5_2",
        source: "a is b && b is c && c is d && d is e && e is f |-",
        expected: "f",
      },
    ],
  },
];

/** ProofWriter-style: complete a reasoning chain given partial premises. */
const PROOFWRITER: TaskPair[] = [
  {
    id: "pw_1",
    source: "socrates is a man. all men are mortal. socrates |-",
    expected: "mortal",
  },
  {
    id: "pw_2",
    source: "if it rains then the ground is wet. it rains. the ground |-",
    expected: "wet",
  },
  {
    id: "pw_3",
    source:
      "all birds have wings. all things with wings can fly. tweety is a bird. tweety |-",
    expected: "fly",
  },
  {
    id: "pw_4",
    source:
      "every prime greater than two is odd. seven is prime. seven is greater than two. seven |-",
    expected: "odd",
  },
  {
    id: "pw_5",
    source: "if A then B. if B then C. A is true. C |-",
    expected: "true",
  },
  {
    id: "pw_6",
    source: "the dog chased the cat. the cat ran away. the cat |-",
    expected: "ran",
  },
];

/** Logical NLI-style: entailment and contradiction. */
const LOGICAL_NLI: { label: "entailment" | "contradiction"; pair: TaskPair }[] =
  [
    // Entailment: premise strongly implies conclusion
    {
      label: "entailment",
      pair: {
        id: "nli_ent_1",
        source: "all cats are animals. felix is a cat. felix is an animal |-",
        expected: "animal",
      },
    },
    {
      label: "entailment",
      pair: {
        id: "nli_ent_2",
        source: "john is tall. john is human. john |-",
        expected: "tall",
      },
    },
    {
      label: "entailment",
      pair: {
        id: "nli_ent_3",
        source: "fire is hot. hot things burn. fire |-",
        expected: "burn",
      },
    },
    // Contradiction: engine should not return the contradicted claim
    {
      label: "contradiction",
      pair: {
        id: "nli_con_1",
        source: "cats are not fish. felix is a cat. felix is a fish |-",
        expected: "",
      },
    },
    {
      label: "contradiction",
      pair: {
        id: "nli_con_2",
        source: "all birds can fly. penguins cannot fly. penguins are birds |-",
        expected: "",
      },
    },
    {
      label: "contradiction",
      pair: {
        id: "nli_con_3",
        source:
          "water is liquid at room temperature. ice is solid. ice is water |-",
        expected: "",
      },
    },
  ];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

async function runQuery(
  source: string,
  traveler: Traveler,
  atomizer: LogicAtomizer,
  system: System
): Promise<{ answer: string; ms: number }> {
  const t0 = performance.now();
  const ids = atomizer.ingestSequence(source, system);
  const resultIds = await traveler.perceive(ids, {});
  const answer = atomizer
    .decodeSequence(resultIds, system)
    .toLowerCase()
    .trim();
  return { answer, ms: performance.now() - t0 };
}

function hitRate(pairs: TaskPair[], answers: Map<string, string>): number {
  let hits = 0;
  for (const p of pairs) {
    const ans = answers.get(p.id) ?? "";
    if (p.expected === "" || ans.includes(p.expected)) hits++;
  }
  return pairs.length === 0 ? 1 : hits / pairs.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ExternalScores {
  date: string;
  ruletaker: {
    hop1: number;
    hop2: number;
    hop3: number;
    hop4: number;
    hop5: number;
    overall: number;
  };
  proofwriter: { chainCompletion: number };
  logicalNli: { entailment: number; contradiction: number; overall: number };
}

async function run(): Promise<void> {
  const BASELINE_PATH = join(
    import.meta.dirname ?? __dirname,
    "metric_ab.baseline.json"
  );

  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();

  const resolver = new Resolver(system, atomizer, store);
  const traveler = createTestMapper(system, atomizer, resolver, store);
  traveler.setGPUEnabled(false);

  // Gather all pairs
  const allPairs: TaskPair[] = [
    ...RULETAKER.flatMap(f => f.pairs),
    ...PROOFWRITER,
    ...LOGICAL_NLI.map(t => t.pair),
  ];

  const answers = new Map<string, string>();

  for (const pair of allPairs) {
    system.reset();
    (DOPAT_CONFIG.PHYSICS as any).CONFORMAL_ENABLED = true;
    const { answer } = await runQuery(pair.source, traveler, atomizer, system);
    answers.set(pair.id, answer);
    console.log(
      `  [${pair.id.padEnd(12)}] answer=${answer.slice(0, 30).padEnd(32)} expected=${pair.expected || "(any)"}`
    );
  }

  await store.close();

  // Score per family
  const rtHopRates: number[] = [];
  for (const family of RULETAKER) {
    const rate = hitRate(family.pairs, answers);
    rtHopRates.push(rate);
    console.log(`  RuleTaker hop-${family.hop}: ${(rate * 100).toFixed(1)}%`);
  }

  const rtOverall = rtHopRates.reduce((a, b) => a + b, 0) / rtHopRates.length;
  const pwRate = hitRate(PROOFWRITER, answers);
  const nliEntRate = hitRate(
    LOGICAL_NLI.filter(t => t.label === "entailment").map(t => t.pair),
    answers
  );
  const nliConRate = hitRate(
    LOGICAL_NLI.filter(t => t.label === "contradiction").map(t => t.pair),
    answers
  );
  const nliOverall = (nliEntRate + nliConRate) / 2;

  console.log(
    `\n  ProofWriter chain-completion: ${(pwRate * 100).toFixed(1)}%`
  );
  console.log(
    `  Logical NLI entailment:       ${(nliEntRate * 100).toFixed(1)}%`
  );
  console.log(
    `  Logical NLI contradiction:    ${(nliConRate * 100).toFixed(1)}%`
  );
  console.log(
    `  RuleTaker overall:            ${(rtOverall * 100).toFixed(1)}%`
  );

  const scores: ExternalScores = {
    date: new Date().toISOString(),
    ruletaker: {
      hop1: parseFloat(rtHopRates[0]?.toFixed(3) ?? "0"),
      hop2: parseFloat(rtHopRates[1]?.toFixed(3) ?? "0"),
      hop3: parseFloat(rtHopRates[2]?.toFixed(3) ?? "0"),
      hop4: parseFloat(rtHopRates[3]?.toFixed(3) ?? "0"),
      hop5: parseFloat(rtHopRates[4]?.toFixed(3) ?? "0"),
      overall: parseFloat(rtOverall.toFixed(3)),
    },
    proofwriter: { chainCompletion: parseFloat(pwRate.toFixed(3)) },
    logicalNli: {
      entailment: parseFloat(nliEntRate.toFixed(3)),
      contradiction: parseFloat(nliConRate.toFixed(3)),
      overall: parseFloat(nliOverall.toFixed(3)),
    },
  };

  // Append to / update baseline JSON
  if (!existsSync(BASELINE_PATH)) {
    console.error(
      `\nBaseline file not found: ${BASELINE_PATH}\nRun tests/benchmarks/metric_ab.ts first to create it.`
    );
    process.exit(1);
  }

  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  const prev = baseline.external as ExternalScores | undefined;

  if (prev) {
    let regressions = 0;
    const check = (name: string, now: number, before: number) => {
      if (now < before - 0.05) {
        console.error(
          `REGRESSION: ${name} dropped from ${(before * 100).toFixed(1)}% to ${(now * 100).toFixed(1)}%`
        );
        regressions++;
      }
    };
    check("ruletaker.hop1", scores.ruletaker.hop1, prev.ruletaker.hop1);
    check("ruletaker.hop2", scores.ruletaker.hop2, prev.ruletaker.hop2);
    check("ruletaker.hop3", scores.ruletaker.hop3, prev.ruletaker.hop3);
    check("ruletaker.hop4", scores.ruletaker.hop4, prev.ruletaker.hop4);
    check("ruletaker.hop5", scores.ruletaker.hop5, prev.ruletaker.hop5);
    check(
      "proofwriter.chainCompletion",
      scores.proofwriter.chainCompletion,
      prev.proofwriter.chainCompletion
    );
    check(
      "logicalNli.entailment",
      scores.logicalNli.entailment,
      prev.logicalNli.entailment
    );
    check(
      "logicalNli.contradiction",
      scores.logicalNli.contradiction,
      prev.logicalNli.contradiction
    );
    if (regressions > 0) {
      console.error(`\n${regressions} regression(s) detected.`);
      process.exit(1);
    }
    console.log("\nNo regressions vs baseline.");
  } else {
    console.log("\nFirst run - external scores written to baseline.");
  }

  baseline.external = scores;
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  console.log(`Baseline updated: ${BASELINE_PATH}`);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
