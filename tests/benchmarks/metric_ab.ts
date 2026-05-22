/**
 * A2 - Conformal metric A/B benchmark.
 * Run: tsx tests/benchmarks/metric_ab.ts
 *
 * Toggles DOPAT_CONFIG.PHYSICS.CONFORMAL_ENABLED and, optionally,
 * A_B_FULL_GRADIENT, measuring per-query quality and perf.
 *
 * Metrics per query:
 *   answerOn   - result text with conformal ON
 *   answerOff  - result text with conformal OFF
 *   match      - whether answers agree
 *   timeOnMs   - wall time conformal ON
 *   timeOffMs  - wall time conformal OFF
 *
 * On first run the per-query results are written to metric_ab.baseline.json.
 * Subsequent runs compare against the baseline; a regression exits with code 1.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DOPAT_CONFIG } from "@config";
import LogicAtomizer from "@atomics/LogicAtomizer";
import type Traveler from "@core_i/Traveler";
import { getMetricForceWithInnerDerivative } from "@core_i/Traveler";
import System from "@core_i/System";
import Store from "@core_s/Memory";
import { createTestMapper } from "@core_i/Runtime";

// ---------------------------------------------------------------------------
// Fixed corpus: (sourceText, expectedPattern)
// Seeded from proactive_paths, verbose_logic_traps, and pcs_e2e corpora.
// "expectedPattern" is a substring that should appear in the result.
// ---------------------------------------------------------------------------

const CORPUS: Array<{ id: string; source: string; expected: string }> = [
  // Identity / basic IS
  { id: "sky_blue", source: "the sky is blue", expected: "blue" },
  { id: "grass_green", source: "grass is green", expected: "green" },
  { id: "water_wet", source: "water is wet", expected: "wet" },

  // Transitive chains
  { id: "trans_2hop", source: "a is b && b is c |-", expected: "c" },
  { id: "trans_3hop", source: "a is b && b is c && c is d |-", expected: "d" },

  // Quantifier
  {
    id: "quant_all",
    source: "all birds are animals. tweety is a bird. tweety |-",
    expected: "animal",
  },
  {
    id: "quant_inst",
    source: "all dogs are mammals. rex is a dog. rex |-",
    expected: "mammal",
  },

  // Modus ponens
  {
    id: "mp_1",
    source: "if it rains then the ground is wet. it rains. the ground |-",
    expected: "wet",
  },
  { id: "mp_2", source: "if P then Q. P is true. Q |-", expected: "true" },

  // Negation / contradiction detection
  {
    id: "neg_1",
    source: "cats are not fish. felix is a cat. felix |-",
    expected: "cat",
  },

  // Verb-frame / action
  { id: "verb_1", source: "newton discovered gravity", expected: "newton" },
  {
    id: "verb_2",
    source: "einstein developed relativity",
    expected: "einstein",
  },

  // Temporal ordering (past vs future)
  { id: "temp_past", source: "rome was founded in 753 bc", expected: "753" },
  {
    id: "temp_fut",
    source: "the meeting will happen tomorrow",
    expected: "tomorrow",
  },

  // Conjunction
  {
    id: "conj_1",
    source: "alice is tall && alice is smart. alice |-",
    expected: "alice",
  },

  // Disjunction
  {
    id: "disj_1",
    source: "either the cat is inside or the cat is outside. the cat |-",
    expected: "cat",
  },

  // Verbose logic traps - expect engine to not time out or loop
  { id: "trap_abbrev", source: "a is b && b is a |-", expected: "" },

  // Long chain (5 hops)
  {
    id: "chain_5hop",
    source: "p is q && q is r && r is s && s is t && t is u |-",
    expected: "u",
  },

  // Self-reference guard
  { id: "self_ref", source: "x is x", expected: "x" },

  // Number
  { id: "num_1", source: "three plus four equals", expected: "" },
];

// ---------------------------------------------------------------------------

interface QueryResult {
  id: string;
  source: string;
  expected: string;
  answerOn: string;
  answerOff: string;
  answerFullGrad: string;
  match: boolean;
  expectedMet: boolean;
  expectedMetFullGrad: boolean;
  timeOnMs: number;
  timeOffMs: number;
  timeFullGradMs: number;
}

interface Baseline {
  date: string;
  results: QueryResult[];
  summary: {
    total: number;
    matchRate: number;
    expectedMetOn: number;
    expectedMetFullGrad: number;
    avgTimeOnMs: number;
    avgTimeOffMs: number;
    avgTimeFullGradMs: number;
  };
}

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

async function run() {
  const BASELINE_PATH = join(
    import.meta.dirname ?? __dirname,
    "metric_ab.baseline.json"
  );

  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();

  const { default: Resolver } = await import("@core_i/Resolver");
  const resolver = new Resolver(system, atomizer, store);
  const traveler = createTestMapper(system, atomizer, resolver, store);

  traveler.setGPUEnabled(false);

  // --- Sanity check of simplified vs. full gradient force ---
  if (CORPUS.length > 0) {
    system.reset();
    const testItem = CORPUS[0];
    const ids = atomizer.ingestSequence(testItem.source, system);
    if (ids.length > 0) {
      (traveler as any).buildGridIndex();
      const firstId = ids[0];
      const px = system.posX[firstId];
      const py = system.posY[firstId];
      const pz = system.posZ[firstId];
      const pw = system.posW[firstId];

      // Simplified force (A_B_FULL_GRADIENT = false)
      (DOPAT_CONFIG.PHYSICS as any).A_B_FULL_GRADIENT = false;
      const simplified = (traveler as any).getMetricForce(
        px,
        py,
        pz,
        pw,
        [],
        undefined
      );

      // Inner derivative force (A_B_FULL_GRADIENT = true, computed via public function)
      const fullGradForce = getMetricForceWithInnerDerivative(
        traveler,
        px,
        py,
        pz,
        pw,
        [],
        undefined
      );

      console.log(`\n--- Conformal Metric Force Sanity Check ---`);
      console.log(
        `Atom ID: ${firstId} at position: [${px.toFixed(4)}, ${py.toFixed(4)}, ${pz.toFixed(4)}, ${pw.toFixed(4)}]`
      );
      console.log(
        `Simplified Force: [V=${simplified[0].toFixed(4)}, fx=${simplified[1].toFixed(4)}, fy=${simplified[2].toFixed(4)}, fz=${simplified[3].toFixed(4)}, fw=${simplified[4].toFixed(4)}]`
      );
      console.log(
        `Full Gradient Force: [V=${fullGradForce[0].toFixed(4)}, fx=${fullGradForce[1].toFixed(4)}, fy=${fullGradForce[2].toFixed(4)}, fz=${fullGradForce[3].toFixed(4)}, fw=${fullGradForce[4].toFixed(4)}]`
      );
      console.log(`-------------------------------------------\n`);
    }
    system.reset();
  }

  const results: QueryResult[] = [];

  for (const item of CORPUS) {
    system.reset();

    // --- conformal ON ---
    (DOPAT_CONFIG.PHYSICS as any).CONFORMAL_ENABLED = true;
    (DOPAT_CONFIG.PHYSICS as any).A_B_FULL_GRADIENT = false;
    const on = await runQuery(item.source, traveler, atomizer, system);

    system.reset();

    // --- conformal OFF ---
    (DOPAT_CONFIG.PHYSICS as any).CONFORMAL_ENABLED = false;
    (DOPAT_CONFIG.PHYSICS as any).A_B_FULL_GRADIENT = false;
    const off = await runQuery(item.source, traveler, atomizer, system);

    system.reset();

    // --- conformal FULL GRADIENT ---
    (DOPAT_CONFIG.PHYSICS as any).CONFORMAL_ENABLED = true;
    (DOPAT_CONFIG.PHYSICS as any).A_B_FULL_GRADIENT = true;
    const fullGrad = await runQuery(item.source, traveler, atomizer, system);

    // restore defaults
    (DOPAT_CONFIG.PHYSICS as any).CONFORMAL_ENABLED = true;
    (DOPAT_CONFIG.PHYSICS as any).A_B_FULL_GRADIENT = false;

    const match = on.answer === off.answer;
    const expectedMet =
      item.expected === "" || on.answer.includes(item.expected);
    const expectedMetFullGrad =
      item.expected === "" || fullGrad.answer.includes(item.expected);

    results.push({
      id: item.id,
      source: item.source,
      expected: item.expected,
      answerOn: on.answer,
      answerOff: off.answer,
      answerFullGrad: fullGrad.answer,
      match,
      expectedMet,
      expectedMetFullGrad,
      timeOnMs: parseFloat(on.ms.toFixed(2)),
      timeOffMs: parseFloat(off.ms.toFixed(2)),
      timeFullGradMs: parseFloat(fullGrad.ms.toFixed(2)),
    });

    console.log(
      `[${match ? "=" : "≠"}] ${item.id.padEnd(14)} ` +
        `ON=${on.answer.slice(0, 20).padEnd(22)} ` +
        `OFF=${off.answer.slice(0, 20).padEnd(22)} ` +
        `FG=${fullGrad.answer.slice(0, 20).padEnd(22)} ` +
        `${on.ms.toFixed(0)}ms / ${off.ms.toFixed(0)}ms / ${fullGrad.ms.toFixed(0)}ms`
    );
  }

  await store.close();

  const total = results.length;
  const matchCount = results.filter(r => r.match).length;
  const expectedMetCount = results.filter(r => r.expectedMet).length;
  const expectedMetFullGradCount = results.filter(
    r => r.expectedMetFullGrad
  ).length;
  const avgOn = results.reduce((s, r) => s + r.timeOnMs, 0) / total;
  const avgOff = results.reduce((s, r) => s + r.timeOffMs, 0) / total;
  const avgFullGrad = results.reduce((s, r) => s + r.timeFullGradMs, 0) / total;

  const summary = {
    total,
    matchRate: parseFloat((matchCount / total).toFixed(3)),
    expectedMetOn: parseFloat((expectedMetCount / total).toFixed(3)),
    expectedMetFullGrad: parseFloat(
      (expectedMetFullGradCount / total).toFixed(3)
    ),
    avgTimeOnMs: parseFloat(avgOn.toFixed(2)),
    avgTimeOffMs: parseFloat(avgOff.toFixed(2)),
    avgTimeFullGradMs: parseFloat(avgFullGrad.toFixed(2)),
  };

  console.log("\n--- Summary ---");
  console.log(
    `  Answers match ON/OFF: ${matchCount}/${total} (${(summary.matchRate * 100).toFixed(1)}%)`
  );
  console.log(
    `  Expected met (ON):    ${expectedMetCount}/${total} (${(summary.expectedMetOn * 100).toFixed(1)}%)`
  );
  console.log(
    `  Expected met (FULL GRAD): ${expectedMetFullGradCount}/${total} (${(summary.expectedMetFullGrad * 100).toFixed(1)}%)`
  );
  console.log(`  Avg time ON:        ${avgOn.toFixed(1)} ms`);
  console.log(`  Avg time OFF:       ${avgOff.toFixed(1)} ms`);
  console.log(`  Avg time FULL GRAD: ${avgFullGrad.toFixed(1)} ms`);

  const baseline: Baseline = {
    date: new Date().toISOString(),
    results,
    summary,
  };

  if (!existsSync(BASELINE_PATH)) {
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
    console.log(`\nBaseline written to ${BASELINE_PATH}`);
  } else {
    const prev: Baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    let regressions = 0;
    for (const r of results) {
      const old = prev.results.find(p => p.id === r.id);
      if (!old) continue;
      if (old.expectedMet && !r.expectedMet) {
        console.error(`REGRESSION: ${r.id} - was correct, now fails`);
        regressions++;
      }
      if (
        old.expectedMetFullGrad !== undefined &&
        old.expectedMetFullGrad &&
        !r.expectedMetFullGrad
      ) {
        console.error(
          `REGRESSION (FULL GRAD): ${r.id} - was correct, now fails`
        );
        regressions++;
      }
    }
    if (regressions > 0) {
      console.error(`\n${regressions} regression(s) detected.`);
      process.exit(1);
    }
    console.log("\nNo regressions vs baseline.");
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
