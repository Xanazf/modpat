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

import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { groundTextIfEnabled } from "@core_s/grounding/TextGrounding";
import Store from "@core_s/Memory";
import {
  type FamilyScore,
  type Gold,
  mapAnswerToVerdict,
  runScoringSelftest,
  type ScoredItem,
  scoreFamily,
  type Verdict,
} from "./scoring";

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
// Real-dataset mode (--datasets): the honest external baseline (PARITY §2).
// Vendored stratified samples of the official AI2 distributions - see
// data/benchmarks/README.md for schema, provenance, and regeneration.
// ---------------------------------------------------------------------------

interface DatasetItem {
  id: string;
  theory: string;
  question: string;
  answer: Gold;
  depth: number;
}

interface RealFamilyScores {
  [family: string]: FamilyScore;
}

interface ExternalRealScores {
  date: string;
  /** ingestSequence + perceive - comparable to the inline families. */
  fast: RealFamilyScores;
  /** Full live path: traveler.process() per theory sentence, then the query. */
  honest: RealFamilyScores;
}

function loadJsonl(path: string): DatasetItem[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l) as DatasetItem);
}

const KEYWORD_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "not",
  "does",
  "do",
  "then",
  "it",
  "to",
  "of",
  "someone",
  "something",
  "they",
]);

/**
 * The expected-content keyword for verdict mapping: the last content token of
 * the question ("Anne is nice." -> "nice", "The cow needs the bear." ->
 * "bear"). Thin and documented on purpose - the mapper's unit cases pin its
 * behaviour so it cannot silently absorb the front-end improvement.
 */
function keywordOf(question: string): string {
  const toks = question
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 0 && !KEYWORD_STOPWORDS.has(t));
  return toks[toks.length - 1] ?? "";
}

function questionNegated(question: string): boolean {
  return /\b(not|cannot|can't|doesn't|don't|isn't|aren't)\b/i.test(question);
}

/** Splits a theory paragraph into individual sentences for the live path. */
function theorySentences(theory: string): string[] {
  return theory
    .split(/(?<=\.)\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

async function runFastItem(item: DatasetItem): Promise<string> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();
  const resolver = new Traveler(system, atomizer, store);
  const traveler = createTestTraveler(system, atomizer, resolver, store);
  traveler.setGPUEnabled(false);
  try {
    // Fast mode gets the same terrain benefit as honest mode: the THEORY's
    // relational geometry is landed before perception. The question is never
    // grounded - that would assert the asked fact into the terrain.
    groundTextIfEnabled(
      theorySentences(item.theory.toLowerCase()),
      system,
      atomizer
    );
    const source = `${item.theory.toLowerCase()} ${item.question
      .toLowerCase()
      .replace(/\.\s*$/, "")} |-`;
    const { answer } = await runQuery(source, traveler, atomizer, system);
    return answer;
  } finally {
    await store.close();
  }
}

/**
 * Honest-path result plus the closed-world safety-valve reading for this
 * item's theory. CWA denial is gated on `textGroundedUnparsed === 0`
 * (GraphQuery), so a theory with even one sentence the parser could not land
 * is CWA-INELIGIBLE no matter how the flag is set - the counters are
 * reported per item so the valve's actual reach is measured, not assumed.
 */
interface HonestItemResult {
  answer: string;
  /** Sentences the grounding path could not land (0 => CWA-eligible). */
  unparsed: number;
  /** Sentences offered to the grounding path. */
  sentences: number;
}

async function runHonestItem(item: DatasetItem): Promise<HonestItemResult> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();
  const resolver = new Traveler(system, atomizer, store);
  const traveler = createTestTraveler(system, atomizer, resolver, store);
  traveler.setGPUEnabled(false);
  try {
    for (const sentence of theorySentences(item.theory)) {
      await traveler.process(sentence.toLowerCase());
    }
    const query = `${item.question.toLowerCase().replace(/\.\s*$/, "")}?`;
    const answer = (await traveler.process(query)).toLowerCase().trim();
    // Read the valve counters BEFORE the store closes. Note these count the
    // theory sentences only if the question itself grounded nothing; the
    // question is processed through the same path, so a question the parser
    // cannot read also makes the theory ineligible - which is correct, the
    // valve is about what the engine could read in total.
    return {
      answer,
      unparsed: system.textGroundedUnparsed,
      sentences: system.textGroundedSentences,
    };
  } finally {
    await store.close();
  }
}

/**
 * Per-item crash-tolerant checkpoint. The honest path exercises the full
 * native stack (DuckDB + atomizer) per item and a segfault 20 items in must
 * not lose the run: an `attempt` line is appended before each item and a
 * `result` line after, so an outer restart loop resumes where it died. An
 * item whose attempt appears >= 2 times with no result is a poison item -
 * skipped and reported, never scored.
 */
interface CheckpointResult {
  kind: "result";
  id: string;
  ds: string;
  depth: number;
  gold: Gold;
  fastVerdict: Verdict;
  honestVerdict: Verdict;
  honestAnswer: string;
  /** Parse-completeness valve reading; absent in checkpoints written before
   *  the instrumentation landed (treated as unknown, not as eligible). */
  unparsed?: number;
  sentences?: number;
}

function loadCheckpoint(path: string): {
  results: Map<string, CheckpointResult>;
  poisoned: Set<string>;
} {
  const results = new Map<string, CheckpointResult>();
  const attempts = new Map<string, number>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line) as { kind: string; id: string };
      if (rec.kind === "attempt")
        attempts.set(rec.id, (attempts.get(rec.id) ?? 0) + 1);
      else if (rec.kind === "result")
        results.set(rec.id, rec as CheckpointResult);
    }
  }
  const poisoned = new Set<string>();
  for (const [id, n] of attempts) {
    if (!results.has(id) && n >= 2) poisoned.add(id);
  }
  return { results, poisoned };
}

async function runDatasetMode(
  dir: string,
  limit: number,
  checkpointPath: string | null,
  cwa: boolean,
  pin: boolean
): Promise<void> {
  runScoringSelftest();

  const BASELINE_PATH = join(
    import.meta.dirname ?? __dirname,
    "metric_ab.baseline.json"
  );
  const datasets: { name: string; items: DatasetItem[] }[] = [
    {
      name: "ruletaker",
      items: loadJsonl(join(dir, "ruletaker_sample.jsonl")),
    },
    {
      name: "proofwriter",
      items: loadJsonl(join(dir, "proofwriter_sample.jsonl")),
    },
  ];

  const checkpoint = checkpointPath
    ? loadCheckpoint(checkpointPath)
    : {
        results: new Map<string, CheckpointResult>(),
        poisoned: new Set<string>(),
      };
  if (checkpoint.results.size > 0)
    console.log(
      `  [checkpoint] resuming: ${checkpoint.results.size} item(s) done, ${checkpoint.poisoned.size} poisoned`
    );

  const fastScored = new Map<string, ScoredItem[]>();
  const honestScored = new Map<string, ScoredItem[]>();
  /** Per-item parse-completeness valve readings (PARITY §3.2 stage 2 reach). */
  const valve: {
    ds: string;
    depth: number;
    unparsed: number;
    sentences?: number;
  }[] = [];
  let skippedPoison = 0;

  for (const ds of datasets) {
    // PARITY §3.2 stage 2 (closed-world negation-as-failure), per dataset.
    //
    // The world assumption is part of a task's DEFINITION: RuleTaker's gold
    // has no `unknown` class at all (its false items are false exactly by
    // negation-as-failure), ProofWriter's OWA split does. So CWA is set to
    // match each dataset rather than globally - RuleTaker on, ProofWriter
    // off - and only under `--cwa`; the default run stays open-world so the
    // pinned baseline keeps measuring the same thing it always did.
    //
    // HISTORY, load-bearing: a prior per-dataset toggle measured honest
    // overall confFalse 5 -> 16 and was reverted. That measurement is
    // CONFOUNDED and must not be cited as evidence about CWA: it was taken
    // against a tree that still had (a) the reflexive-derivation guard later
    // proven WRONG against gold labels, which "silently flipp[ed] correct
    // derivations to wrong denials once combined with closed-world mode"
    // (data/benchmarks/README.md - the same 5 -> 16 run), and (b) the
    // ungated `perceiveCoherent` path that produced all 5 of that tree's
    // baseline confident falsehoods. Both were fixed at 87fca2a, which took
    // the baseline to confFalse 0. CWA has not been measured since.
    if (cwa) {
      const on = ds.name === "ruletaker";
      (
        DOPAT_CONFIG.PHYSICS as unknown as { TEXT_GRAPH_CWA_ENABLED: boolean }
      ).TEXT_GRAPH_CWA_ENABLED = on;
      console.log(
        `  [cwa] ${ds.name}: closed-world ${on ? "ON" : "OFF"} (dataset's own world assumption)`
      );
    }
    const items = limit > 0 ? ds.items.slice(0, limit) : ds.items;
    for (const item of items) {
      if (checkpoint.poisoned.has(item.id)) {
        skippedPoison++;
        console.log(`  [${item.id.padEnd(28)}] POISONED - skipped, not scored`);
        continue;
      }

      let fastVerdict: Verdict;
      let honestVerdict: Verdict;
      let honestAnswer: string;
      let unparsed: number | undefined;
      let sentences: number | undefined;
      const prior = checkpoint.results.get(item.id);
      if (prior) {
        ({ fastVerdict, honestVerdict, honestAnswer } = prior);
        unparsed = prior.unparsed;
        sentences = prior.sentences;
      } else {
        if (checkpointPath)
          appendFileSync(
            checkpointPath,
            `${JSON.stringify({ kind: "attempt", id: item.id })}\n`
          );
        const negated = questionNegated(item.question);
        const keyword = keywordOf(item.question);
        const fastAnswer = await runFastItem(item);
        const honest = await runHonestItem(item);
        honestAnswer = honest.answer;
        unparsed = honest.unparsed;
        sentences = honest.sentences;
        fastVerdict = mapAnswerToVerdict(fastAnswer, keyword, negated);
        honestVerdict = mapAnswerToVerdict(honestAnswer, keyword, negated);
        if (checkpointPath) {
          const rec: CheckpointResult = {
            kind: "result",
            id: item.id,
            ds: ds.name,
            depth: item.depth,
            gold: item.answer,
            fastVerdict,
            honestVerdict,
            honestAnswer,
            unparsed,
            sentences,
          };
          appendFileSync(checkpointPath, `${JSON.stringify(rec)}\n`);
        }
      }
      if (unparsed !== undefined) {
        valve.push({ ds: ds.name, depth: item.depth, unparsed, sentences });
      }

      const family = `${ds.name}.d${item.depth}`;
      for (const [map, verdict] of [
        [fastScored, fastVerdict],
        [honestScored, honestVerdict],
      ] as const) {
        if (!map.has(family)) map.set(family, []);
        map.get(family)?.push({ gold: item.answer, verdict });
      }
      console.log(
        `  [${item.id.padEnd(28)}] gold=${item.answer.padEnd(7)} fast=${fastVerdict.padEnd(7)} honest=${honestVerdict.padEnd(7)} "${honestAnswer.slice(0, 40)}"${prior ? " (checkpoint)" : ""}`
      );
    }
  }
  (
    DOPAT_CONFIG.PHYSICS as unknown as { TEXT_GRAPH_CWA_ENABLED: boolean }
  ).TEXT_GRAPH_CWA_ENABLED = false;

  if (skippedPoison > 0)
    console.warn(
      `\n  WARNING: ${skippedPoison} poisoned item(s) skipped (crashed twice) - excluded from scoring.`
    );

  const collect = (map: Map<string, ScoredItem[]>): RealFamilyScores => {
    const out: RealFamilyScores = {};
    const all: ScoredItem[] = [];
    for (const [family, items] of [...map.entries()].sort()) {
      out[family] = scoreFamily(items);
      all.push(...items);
    }
    out.overall = scoreFamily(all);
    return out;
  };

  const scores: ExternalRealScores = {
    date: new Date().toISOString(),
    fast: collect(fastScored),
    honest: collect(honestScored),
  };

  // Parse-completeness valve reach (PARITY §3.2 stage 2 diagnostic). CWA
  // denial is double-gated on TEXT_GRAPH_CWA_ENABLED && unparsed === 0, so
  // this measures the CEILING of closed-world mode independently of whether
  // its logic is right: an item whose theory did not fully land can never be
  // denied, flag or no flag. A low eligible-rate here means the next item is
  // parser coverage (PARITY §3.1 residual), not CWA.
  if (valve.length > 0) {
    console.log("\n  -- parse-completeness valve (CWA eligibility) --");
    const byFamily = new Map<string, { n: number; eligible: number }>();
    for (const v of valve) {
      const key = `${v.ds}.d${v.depth}`;
      const rec = byFamily.get(key) ?? { n: 0, eligible: 0 };
      rec.n++;
      if (v.unparsed === 0) rec.eligible++;
      byFamily.set(key, rec);
    }
    let totN = 0;
    let totEligible = 0;
    for (const [family, r] of [...byFamily.entries()].sort()) {
      totN += r.n;
      totEligible += r.eligible;
      console.log(
        `  ${family.padEnd(16)} eligible=${String(r.eligible).padStart(3)}/${String(r.n).padEnd(3)} (${((r.eligible / r.n) * 100).toFixed(1)}%)`
      );
    }
    console.log(
      `  ${"overall".padEnd(16)} eligible=${String(totEligible).padStart(3)}/${String(totN).padEnd(3)} (${((totEligible / totN) * 100).toFixed(1)}%)`
    );
  }

  for (const mode of ["fast", "honest"] as const) {
    console.log(`\n  -- ${mode} --`);
    for (const [family, s] of Object.entries(scores[mode])) {
      console.log(
        `  ${family.padEnd(16)} balAcc=${(s.balancedAccuracy * 100).toFixed(1).padStart(5)}%  abstain=${(s.abstentionRate * 100).toFixed(1).padStart(5)}%  confFalse=${s.confidentFalsehoods}  n=${s.n}`
      );
    }
  }

  if (!existsSync(BASELINE_PATH)) {
    console.error(`\nBaseline file not found: ${BASELINE_PATH}`);
    process.exit(1);
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  const prev = baseline.externalReal as ExternalRealScores | undefined;

  if (prev && limit <= 0) {
    let regressions = 0;
    for (const mode of ["fast", "honest"] as const) {
      for (const [family, prevScore] of Object.entries(prev[mode] ?? {})) {
        const now = scores[mode][family];
        if (!now) continue;
        if (now.balancedAccuracy < prevScore.balancedAccuracy - 0.05) {
          console.error(
            `REGRESSION: ${mode}.${family} balancedAccuracy ${(prevScore.balancedAccuracy * 100).toFixed(1)}% -> ${(now.balancedAccuracy * 100).toFixed(1)}%`
          );
          regressions++;
        }
        if (now.confidentFalsehoods > prevScore.confidentFalsehoods) {
          console.error(
            `REGRESSION: ${mode}.${family} confidentFalsehoods ${prevScore.confidentFalsehoods} -> ${now.confidentFalsehoods} (characteristic failure must remain silence)`
          );
          regressions++;
        }
      }
    }
    if (regressions > 0) {
      // --accept: pin the new scores anyway. For deliberate, human-reviewed
      // baseline moves (e.g. a front-end change whose per-item diff shows the
      // family-level dips are verdict-mapper coin flips on garbage answers,
      // not capability loss). Never use it to silence an unexplained drop.
      if (process.argv.includes("--accept")) {
        console.warn(
          `\n${regressions} regression(s) ACCEPTED via --accept - pinning new scores as baseline.`
        );
      } else {
        console.error(`\n${regressions} regression(s) detected.`);
        process.exit(1);
      }
    } else {
      console.log("\nNo regressions vs externalReal baseline.");
    }
  } else if (!prev && limit <= 0) {
    console.log(
      "\nFirst dataset run - externalReal scores written to baseline."
    );
  }

  if (limit <= 0 && pin) {
    baseline.externalReal = scores;
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Baseline updated: ${BASELINE_PATH}`);
  } else if (!pin) {
    // --no-pin: an EXPLORATORY run (e.g. --cwa) reads the pin to report its
    // diff but must never overwrite it; the pin moves only on a deliberate
    // default-configuration run.
    console.log("\n--no-pin exploratory run - baseline NOT updated.");
  } else {
    console.log(`\n--limit ${limit} smoke run - baseline NOT updated.`);
  }
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
  const dsIdx = process.argv.indexOf("--datasets");
  if (dsIdx >= 0) {
    const next = process.argv[dsIdx + 1];
    const dir =
      next && !next.startsWith("--")
        ? next
        : join(
            import.meta.dirname ?? __dirname,
            "..",
            "..",
            "data",
            "benchmarks"
          );
    const limitIdx = process.argv.indexOf("--limit");
    const limit =
      limitIdx >= 0
        ? Number.parseInt(process.argv[limitIdx + 1] ?? "0", 10)
        : 0;
    const ckIdx = process.argv.indexOf("--checkpoint");
    const checkpointPath =
      ckIdx >= 0 ? (process.argv[ckIdx + 1] ?? null) : null;
    // --cwa: closed-world per dataset (RuleTaker on, ProofWriter off).
    // --no-pin: report the diff vs the pin without overwriting it. Implied by
    // --cwa, since a CWA run is by definition not the default configuration.
    const cwa = process.argv.includes("--cwa");
    const pin = !cwa && !process.argv.includes("--no-pin");
    await runDatasetMode(
      dir,
      Number.isNaN(limit) ? 0 : limit,
      checkpointPath,
      cwa,
      pin
    );
    return;
  }

  const BASELINE_PATH = join(
    import.meta.dirname ?? __dirname,
    "metric_ab.baseline.json"
  );

  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();

  const resolver = new Traveler(system, atomizer, store);
  const traveler = createTestTraveler(system, atomizer, resolver, store);
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
    (DOPAT_CONFIG.PHYSICS as { CONFORMAL_ENABLED: boolean }).CONFORMAL_ENABLED =
      true;
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
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Baseline updated: ${BASELINE_PATH}`);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
