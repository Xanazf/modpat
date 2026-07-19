/**
 * Stage-3 paraphrase-family harness (PARITY §6 Stage 3).
 * Run: tsx tests/benchmarks/paraphrase_families.ts [--family <name>]
 *
 * The key move against the §3.1 front-end bottleneck: ONE fact-set per family,
 * ingested ONCE into a fresh engine; then N surface variants of the SAME query
 * run against that fixed terrain. The map is the invariant and only the
 * reading varies - so every failure is attributable to the language front-end,
 * never the terrain, and each repaired parse is a reusable translation gain.
 *
 * Scoring is the shared abstention-aware metric (scoring.ts). Results pin to
 * tests/benchmarks/metric_ab.baseline.json under "paraphrase", keyed per
 * family. Regression policy (hard fail):
 *   - balancedAccuracy must not drop > 0.05 for any family
 *   - confidentFalsehoods must not increase for any family
 *     (the characteristic failure must remain silence, never confident
 *     falsehood)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";
import {
  type FamilyScore,
  type Gold,
  mapAnswerToVerdict,
  runScoringSelftest,
  type ScoredItem,
  scoreFamily,
} from "./scoring";

// ---------------------------------------------------------------------------
// Families: fixed terrain + surface variants of one query
// ---------------------------------------------------------------------------

interface ParaphraseQuery {
  /** Surface variant of the query. */
  text: string;
  /** Gold label for this variant (same for all variants of a family). */
  gold: Gold;
  /** Expected-content keyword for the verdict mapper. */
  keyword: string;
  /** True when the query surface itself is negated. */
  negated?: boolean;
}

interface ParaphraseFamily {
  name: string;
  /** Facts ingested once, in order, before any query runs. */
  facts: string[];
  queries: ParaphraseQuery[];
}

const FAMILIES: ParaphraseFamily[] = [
  {
    // Naturalized from the logic-sweep taxonomy corpus - hop-1 membership.
    name: "taxonomy_hop1",
    facts: [
      "cats are mammals",
      "dogs are mammals",
      "mammals are animals",
      "felix is a cat",
      "rex is a dog",
    ],
    queries: [
      { text: "is felix a mammal?", gold: "true", keyword: "mammal" },
      { text: "felix is a mammal?", gold: "true", keyword: "mammal" },
      {
        text: "would you say felix is a mammal?",
        gold: "true",
        keyword: "mammal",
      },
      { text: "felix is a mammal, right?", gold: "true", keyword: "mammal" },
      {
        text: "is it true that felix is a mammal?",
        gold: "true",
        keyword: "mammal",
      },
      {
        text: "does it follow that felix is a mammal?",
        gold: "true",
        keyword: "mammal",
      },
      { text: "what is felix?", gold: "true", keyword: "cat" },
    ],
  },
  {
    name: "taxonomy_hop3",
    facts: [
      "roses are flowers",
      "flowers are plants",
      "plants are organisms",
      "a rose is in the garden",
    ],
    queries: [
      { text: "are roses organisms?", gold: "true", keyword: "organism" },
      { text: "roses are organisms?", gold: "true", keyword: "organism" },
      { text: "is a rose an organism?", gold: "true", keyword: "organism" },
      {
        text: "would a rose count as an organism?",
        gold: "true",
        keyword: "organism",
      },
      {
        text: "is it the case that roses are organisms?",
        gold: "true",
        keyword: "organism",
      },
      {
        text: "does it follow that a rose is an organism?",
        gold: "true",
        keyword: "organism",
      },
    ],
  },
  {
    name: "implication_chain",
    facts: [
      "if it rains then the ground is wet",
      "if the ground is wet then the grass grows",
      "it rains",
    ],
    queries: [
      { text: "does the grass grow?", gold: "true", keyword: "grow" },
      { text: "is the grass growing?", gold: "true", keyword: "grow" },
      { text: "the grass grows?", gold: "true", keyword: "grow" },
      { text: "so the grass grows, right?", gold: "true", keyword: "grow" },
      { text: "would the grass grow?", gold: "true", keyword: "grow" },
      {
        text: "is it true that the grass grows?",
        gold: "true",
        keyword: "grow",
      },
    ],
  },
  {
    name: "negation_contrast",
    facts: ["cats are not fish", "felix is a cat", "fish can swim"],
    queries: [
      { text: "is felix a fish?", gold: "false", keyword: "fish" },
      { text: "felix is a fish?", gold: "false", keyword: "fish" },
      {
        text: "would you say felix is a fish?",
        gold: "false",
        keyword: "fish",
      },
      {
        text: "is it true that felix is a fish?",
        gold: "false",
        keyword: "fish",
      },
      { text: "felix is a fish, right?", gold: "false", keyword: "fish" },
      {
        text: "is felix not a fish?",
        gold: "true",
        keyword: "fish",
        negated: true,
      },
    ],
  },
  {
    name: "arithmetic_wordform",
    facts: ["three plus four equals seven"],
    queries: [
      { text: "what is three plus four?", gold: "true", keyword: "seven" },
      { text: "what do three and four make?", gold: "true", keyword: "seven" },
      { text: "how much is three plus four?", gold: "true", keyword: "seven" },
      { text: "three plus four equals what?", gold: "true", keyword: "seven" },
      {
        text: "what does three plus four come to?",
        gold: "true",
        keyword: "seven",
      },
      { text: "add three and four?", gold: "true", keyword: "seven" },
    ],
  },
  {
    // Abstention control: nothing in the terrain supports these - the gate
    // must stay SILENT. gold=unknown means abstain is the only correct verdict.
    name: "unknown_control",
    facts: ["cats are mammals", "felix is a cat"],
    queries: [
      { text: "is felix hungry?", gold: "unknown", keyword: "hungry" },
      { text: "does felix like water?", gold: "unknown", keyword: "water" },
      { text: "is felix three years old?", gold: "unknown", keyword: "old" },
      { text: "can felix fly?", gold: "unknown", keyword: "fly" },
      { text: "is rex a mammal?", gold: "unknown", keyword: "mammal" },
      { text: "who owns felix?", gold: "unknown", keyword: "owner" },
    ],
  },
];

// ---------------------------------------------------------------------------

interface ParaphraseScores {
  date: string;
  families: { [family: string]: FamilyScore };
}

async function runFamily(family: ParaphraseFamily): Promise<ScoredItem[]> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();
  const resolver = new Traveler(system, atomizer, store);
  const traveler = createTestTraveler(system, atomizer, resolver, store);
  traveler.setGPUEnabled(false);

  const scored: ScoredItem[] = [];
  try {
    // Terrain: ingested once. Every query below reads the SAME map.
    for (const fact of family.facts) {
      await traveler.process(fact);
    }
    for (const q of family.queries) {
      const answer = (await traveler.process(q.text)).toLowerCase().trim();
      const verdict = mapAnswerToVerdict(answer, q.keyword, q.negated ?? false);
      scored.push({ gold: q.gold, verdict });
      console.log(
        `  [${family.name}] "${q.text}" -> ${verdict.padEnd(7)} (gold ${q.gold})  "${answer.slice(0, 40)}"`
      );
    }
  } finally {
    await store.close();
  }
  return scored;
}

async function run(): Promise<void> {
  runScoringSelftest();

  const famIdx = process.argv.indexOf("--family");
  const only = famIdx >= 0 ? process.argv[famIdx + 1] : null;
  const families = only ? FAMILIES.filter(f => f.name === only) : FAMILIES;
  if (families.length === 0) {
    console.error(`No family named ${only}`);
    process.exit(1);
  }

  const results: ParaphraseScores = {
    date: new Date().toISOString(),
    families: {},
  };
  for (const family of families) {
    const scored = await runFamily(family);
    results.families[family.name] = scoreFamily(scored);
  }

  console.log("\n  -- family scores --");
  for (const [name, s] of Object.entries(results.families)) {
    console.log(
      `  ${name.padEnd(20)} balAcc=${(s.balancedAccuracy * 100).toFixed(1).padStart(5)}%  abstain=${(s.abstentionRate * 100).toFixed(1).padStart(5)}%  confFalse=${s.confidentFalsehoods}  n=${s.n}`
    );
  }

  const BASELINE_PATH = join(
    import.meta.dirname ?? __dirname,
    "metric_ab.baseline.json"
  );
  if (!existsSync(BASELINE_PATH)) {
    console.error(`\nBaseline file not found: ${BASELINE_PATH}`);
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  const prev = baseline.paraphrase as ParaphraseScores | undefined;

  if (prev && !only) {
    let regressions = 0;
    for (const [name, prevScore] of Object.entries(prev.families)) {
      const now = results.families[name];
      if (!now) continue;
      if (now.balancedAccuracy < prevScore.balancedAccuracy - 0.05) {
        console.error(
          `REGRESSION: ${name} balancedAccuracy ${(prevScore.balancedAccuracy * 100).toFixed(1)}% -> ${(now.balancedAccuracy * 100).toFixed(1)}%`
        );
        regressions++;
      }
      if (now.confidentFalsehoods > prevScore.confidentFalsehoods) {
        console.error(
          `REGRESSION: ${name} confidentFalsehoods ${prevScore.confidentFalsehoods} -> ${now.confidentFalsehoods} (characteristic failure must remain silence)`
        );
        regressions++;
      }
    }
    if (regressions > 0) {
      console.error(`\n${regressions} regression(s) detected.`);
      process.exit(1);
    }
    console.log("\nNo regressions vs paraphrase baseline.");
  } else if (!prev) {
    console.log("\nFirst run - paraphrase scores written to baseline.");
  }

  if (!only) {
    baseline.paraphrase = results;
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2));
    console.log(`Baseline updated: ${BASELINE_PATH}`);
  } else {
    console.log("\n--family run - baseline NOT updated.");
  }
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
