/**
 * The honest external baseline for code synthesis (PARITY §3.5).
 *
 * Run: tsx tests/benchmarks/code_benchmark.ts [--roundtrip] [--humaneval]
 *      [--limit N] [--checkpoint <path>] [--pin] [--corpus none|stdlib]
 *
 * PARITY §2's load-bearing honesty caveat, applied to the code family: no
 * number is a parity claim until the actual dataset files run through the
 * pipeline. §3.5 currently cites "behavioural fidelity (arith / code) 1.000 /
 * 1.000", but that code channel measures `a + b` / `a - b` reduction against W
 * geometry with tsx as the oracle (CodeBehaviouralFidelity.ts) - it never
 * touches the Synthesizer's emitted text. This file measures the thing §3.5 is
 * actually about: does the engine EMIT a function that passes the problem's own
 * unit tests.
 *
 * TWO MODES, and the distinction is the point:
 *
 *   --roundtrip  The CHANNEL probe. Ingest the Stage-1 corpus, then ask each
 *                corpus function back by its own intent phrase and execute what
 *                comes out against the original. No generalization is required
 *                or measured: this is "can the storage/emission channel return
 *                a function it has literally been shown". It is an upper bound
 *                on everything below - a synthesizer that cannot re-emit what
 *                it stored cannot emit anything else either - and it needs no
 *                external data, so it is a cheap standing regression surface.
 *
 *   --humaneval  The PARITY number. All 159 MultiPL-E TypeScript HumanEval
 *                problems; the candidate is spliced into the official prompt,
 *                the official tests run it in a child process. Nothing about
 *                the manifold reaches that process, so this is fidelity to
 *                behaviour in the same non-circular sense the arithmetic
 *                channel claims.
 *
 * SCORING is the covenant's, not pass@1 alone (PARITY §1: abstention is scored
 * separately, never as failure). Every item lands in exactly one bucket:
 *
 *   abstain   - the engine committed to nothing ("unknown" / empty).
 *   pass      - committed, and the official tests are green.
 *   fail      - committed, valid TypeScript, tests red.
 *   invalid   - committed, but the emission does not even parse.
 *   timeout   - committed, and the candidate did not terminate.
 *
 * `confidentFalsehoods` = every committed item that is not `pass`. `invalid` is
 * counted there deliberately: an emission that does not parse is still a
 * commitment the engine made, and calling it abstention would flatter the
 * covenant metric by reclassifying garbage as silence.
 */

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";
import { deriveIntent } from "@skill_code/Coder";
import {
  candidatePool,
  parseExamples,
  verifiedSynthesis,
} from "@skill_code/Toolkit";
import { type AstNode, parse, walk } from "abstract-syntax-tree";
import { CODE_CORPUS } from "./code_corpus";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CodeOutcome = "abstain" | "pass" | "fail" | "invalid" | "timeout";

export interface CodeItem {
  id: string;
  entryPoint: string;
  prompt: string;
  tests: string;
  stopTokens: string[];
}

export interface CodeScore {
  /** pass / n - the standard pass@1, computed over every item. */
  passAt1: number;
  /** Fraction of items the engine declined to answer. */
  abstentionRate: number;
  /** Committed-and-not-passing: fail + invalid + timeout. */
  confidentFalsehoods: number;
  /** Full bucket census, so a headline number can never hide a shift. */
  buckets: Record<CodeOutcome, number>;
  n: number;
}

const EMPTY_BUCKETS = (): Record<CodeOutcome, number> => ({
  abstain: 0,
  pass: 0,
  fail: 0,
  invalid: 0,
  timeout: 0,
});

export function scoreCode(outcomes: CodeOutcome[]): CodeScore {
  const buckets = EMPTY_BUCKETS();
  for (const o of outcomes) buckets[o]++;
  const n = outcomes.length;
  return {
    passAt1: n === 0 ? 0 : buckets.pass / n,
    abstentionRate: n === 0 ? 0 : buckets.abstain / n,
    confidentFalsehoods: buckets.fail + buckets.invalid + buckets.timeout,
    buckets,
    n,
  };
}

// ---------------------------------------------------------------------------
// Emission classification
// ---------------------------------------------------------------------------

/** Surfaces that mean "the engine did not commit" - the abstention contract. */
const ABSTAIN_RE = /^\s*$|^unknown$|^i (don't|do not) know\b|cannot determine/i;

export function isAbstention(answer: string): boolean {
  return ABSTAIN_RE.test(answer.trim());
}

/**
 * Classifies the child process's failure. esbuild rejects a malformed emission
 * before any test runs, which is a categorically different failure from a
 * program that ran and got the wrong answer - and for §3.5 the difference is
 * the whole diagnosis, so it never gets folded into one "wrong" bucket.
 */
function classifyFailure(stderr: string): CodeOutcome {
  if (
    /TransformError|Transform failed|SyntaxError|ERROR: Expected/i.test(stderr)
  )
    return "invalid";
  return "fail";
}

// ---------------------------------------------------------------------------
// Territory contact: run the candidate
// ---------------------------------------------------------------------------

const TIMEOUT_MS = 10_000;

/**
 * Executes `preamble + candidate + harness` as real TypeScript through tsx and
 * reports what happened. The child never sees a manifold coordinate - that is
 * the whole non-circularity argument (CodeBehaviouralFidelity.ts, §3.5's
 * "tsx execution = free territory contact").
 */
export function executeCandidate(
  preamble: string,
  candidate: string,
  harness: string
): { outcome: CodeOutcome; stderr: string } {
  const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
  if (!existsSync(tsxBin))
    throw new Error(`code benchmark: tsx binary not found at ${tsxBin}`);

  const dir = mkdtempSync(join(tmpdir(), "modpat-code-"));
  const file = join(dir, "candidate.ts");
  writeFileSync(file, `${preamble}${candidate}\n${harness}\n`);
  try {
    execFileSync(tsxBin, [file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    });
    return { outcome: "pass", stderr: "" };
  } catch (e: unknown) {
    const err = e as { stderr?: string; signal?: string; code?: string };
    if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT")
      return { outcome: "timeout", stderr: "timeout" };
    const stderr = String(err.stderr ?? "");
    return { outcome: classifyFailure(stderr), stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface Engine {
  traveler: Traveler;
  store: Store;
  close: () => Promise<void>;
}

/** A fresh manifold + vault, optionally primed with the Stage-1 corpus. */
async function boot(primed: boolean): Promise<Engine> {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();
  const resolver = new Traveler(system, atomizer, store);
  const traveler = createTestTraveler(system, atomizer, resolver, store);
  traveler.setGPUEnabled(false);
  if (primed) await traveler.processCode(CODE_CORPUS);
  return { traveler, store, close: () => store.close() };
}

/** Asks for a synthesis and returns the raw emission. */
async function ask(traveler: Traveler, intent: string): Promise<string> {
  return (await traveler.process(`${intent} |-`)).trim();
}

// ---------------------------------------------------------------------------
// Mode: round-trip channel probe
// ---------------------------------------------------------------------------

/**
 * Behavioural checks for corpus functions, keyed by declared name. A function
 * without an entry here is not probed - the map is the probe's scope, and it is
 * kept explicit so adding a corpus entry never silently widens the number.
 */
const ROUNDTRIP_CHECKS: Record<string, string> = {
  sumOf: "assert.strictEqual(sumOf(2,3),5);",
  subtract: "assert.strictEqual(subtract(5,3),2);",
  productOf: "assert.strictEqual(productOf(4,3),12);",
  divide: "assert.strictEqual(divide(6,3),2);",
  remainder: "assert.strictEqual(remainder(7,4),3);",
  negate: "assert.strictEqual(negate(3),-3);",
  absolute:
    "assert.strictEqual(absolute(-3),3);assert.strictEqual(absolute(3),3);",
  greaterOf:
    "assert.strictEqual(greaterOf(4,9),9);assert.strictEqual(greaterOf(9,4),9);",
  lesserOf: "assert.strictEqual(lesserOf(4,9),4);",
  equals:
    "assert.strictEqual(equals(2,2),true);assert.strictEqual(equals(2,3),false);",
  greater: "assert.strictEqual(greater(3,2),true);",
  less: "assert.strictEqual(less(2,3),true);",
  isEven:
    "assert.strictEqual(isEven(4),true);assert.strictEqual(isEven(5),false);",
  isOdd: "assert.strictEqual(isOdd(5),true);",
  isPositive:
    "assert.strictEqual(isPositive(1),true);assert.strictEqual(isPositive(-1),false);",
  isEmpty:
    "assert.strictEqual(isEmpty([]),true);assert.strictEqual(isEmpty([1]),false);",
  sum: "assert.strictEqual(sum([1,2,3]),6);",
  count: "assert.strictEqual(count([1,2,3]),3);",
  largest: "assert.strictEqual(largest([1,9,3]),9);",
  smallest: "assert.strictEqual(smallest([4,1,3]),1);",
  contains:
    "assert.strictEqual(contains([1,2],2),true);assert.strictEqual(contains([1,2],5),false);",
  reverse: "assert.deepEqual(reverse([1,2,3]),[3,2,1]);",
  filterPositive: "assert.deepEqual(filterPositive([1,-2,3]),[1,3]);",
  mapDouble: "assert.deepEqual(mapDouble([1,2]),[2,4]);",
  concat: "assert.strictEqual(concat('a','b'),'ab');",
  length: "assert.strictEqual(length('abc'),3);",
  upper: "assert.strictEqual(upper('ab'),'AB');",
  lower: "assert.strictEqual(lower('AB'),'ab');",
  startsWith: "assert.strictEqual(startsWith('abc','a'),true);",
};

interface RoundTripCase {
  name: string;
  /** The phrase INGESTION minted for this node, not a paraphrase of it. */
  intent: string;
  check: string;
}

/**
 * Builds the probe's case list by walking the same corpus `processCode` walks
 * and asking `deriveIntent` for each declaration's phrase. Asking by the minted
 * phrase is what makes this a CHANNEL probe: a miss here cannot be explained
 * away as the query having been worded differently from the key.
 */
function roundTripCases(): RoundTripCase[] {
  const ast = parse(CODE_CORPUS, { module: false }) as AstNode;
  const cases: RoundTripCase[] = [];
  walk(ast, (node: AstNode) => {
    if (node.type !== "FunctionDeclaration") return;
    const name = node.id?.name;
    if (!name) return;
    const check = ROUNDTRIP_CHECKS[name];
    if (!check) return;
    cases.push({ name, intent: deriveIntent(node), check });
  });
  return cases;
}

const ASSERT_PREAMBLE =
  "declare var require: any;\nconst assert = require('node:assert');\n";

async function runRoundTrip(limit: number): Promise<CodeScore> {
  console.log("\n== round-trip channel probe (corpus in -> corpus out) ==\n");
  const engine = await boot(true);
  const outcomes: CodeOutcome[] = [];
  const all = roundTripCases();
  const cases = limit > 0 ? all.slice(0, limit) : all;
  try {
    for (const c of cases) {
      const emitted = await ask(engine.traveler, c.intent);
      let outcome: CodeOutcome;
      let note = "";
      if (isAbstention(emitted)) {
        outcome = "abstain";
      } else {
        const r = executeCandidate(ASSERT_PREAMBLE, emitted, c.check);
        outcome = r.outcome;
        note = r.stderr.split("\n")[0]?.slice(0, 60) ?? "";
      }
      outcomes.push(outcome);
      console.log(
        `  [${c.name.padEnd(14)}] ${outcome.padEnd(8)} <- ${JSON.stringify(emitted).slice(0, 70)}${note && outcome !== "pass" ? `  (${note})` : ""}`
      );
    }
  } finally {
    await engine.close();
  }
  return scoreCode(outcomes);
}

// ---------------------------------------------------------------------------
// Mode: HumanEval-TS
// ---------------------------------------------------------------------------

function loadItems(path: string): CodeItem[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l) as CodeItem);
}

/**
 * The NAME surface: `deriveIntent`'s own phrasing for the function under
 * synthesis ("has_close_elements" -> "function has close elements"). This is
 * the most generous reading the engine could possibly be given - it is the
 * exact string the ingestion path would have minted had it seen the solution -
 * so it isolates synthesis from reading (PARITY §3.1's inversion, applied here).
 */
export function nameSurface(entryPoint: string): string {
  const spaced = entryPoint
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return `function ${spaced}`;
}

/**
 * The DOC surface: the problem's prose, which is what a HumanEval-class task
 * actually poses. Comment markers are stripped and the doctest examples
 * dropped, leaving the natural-language specification.
 */
export function docSurface(prompt: string): string {
  const lines: string[] = [];
  for (const raw of prompt.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("//")) continue;
    const body = line.replace(/^\/\/+\s?/, "").trim();
    if (body.startsWith(">>>")) break;
    if (body.length > 0) lines.push(body);
  }
  return lines.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Splices a candidate into the official prompt. MultiPL-E prompts end with the
 * signature and an open brace, so a completion is a function BODY. An emission
 * that already restates a whole `function ...` declaration cannot be spliced
 * there - it would nest - so it replaces the prompt's own body instead, and the
 * signature the tests call is preserved by aliasing the entry point.
 */
export function splice(
  item: CodeItem,
  emitted: string
): {
  preamble: string;
  candidate: string;
} {
  const trimmed = emitted.trim();
  if (/^\s*(function|const|let|var|class)\b/.test(trimmed)) {
    // Standalone declaration: keep the prompt as a comment for provenance, emit
    // the declaration on its own, and alias it to the tested name if it differs.
    const declared = trimmed.match(
      /(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/
    )?.[1];
    const alias =
      declared && declared !== item.entryPoint
        ? `\nconst ${item.entryPoint} = ${declared};\n`
        : "\n";
    return { preamble: "", candidate: `${trimmed}${alias}` };
  }
  return { preamble: item.prompt, candidate: `${trimmed}\n}\n` };
}

interface HumanEvalConfig {
  /** "cold" = empty vault, "stdlib" = primed with the Stage-1 corpus. */
  corpus: "none" | "stdlib";
  /** Which question surface the engine is asked. */
  surface: "name" | "doc";
}

interface CheckpointRecord {
  kind: "result";
  id: string;
  config: string;
  outcome: CodeOutcome;
  emitted: string;
}

function loadCheckpoint(path: string): {
  results: Map<string, CheckpointRecord>;
  poisoned: Set<string>;
} {
  const results = new Map<string, CheckpointRecord>();
  const attempts = new Map<string, number>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const rec = JSON.parse(line) as {
        kind: string;
        id: string;
        config: string;
      };
      const key = `${rec.config}::${rec.id}`;
      if (rec.kind === "attempt")
        attempts.set(key, (attempts.get(key) ?? 0) + 1);
      else if (rec.kind === "result")
        results.set(key, rec as unknown as CheckpointRecord);
    }
  }
  const poisoned = new Set<string>();
  for (const [key, n] of attempts)
    if (!results.has(key) && n >= 2) poisoned.add(key);
  return { results, poisoned };
}

async function runHumanEval(
  items: CodeItem[],
  cfg: HumanEvalConfig,
  checkpointPath: string | null
): Promise<CodeScore> {
  const label = `${cfg.corpus}/${cfg.surface}`;
  console.log(`\n== humaneval-ts [${label}] ==\n`);
  const checkpoint = checkpointPath
    ? loadCheckpoint(checkpointPath)
    : {
        results: new Map<string, CheckpointRecord>(),
        poisoned: new Set<string>(),
      };

  const outcomes: CodeOutcome[] = [];
  for (const item of items) {
    const key = `${label}::${item.id}`;
    if (checkpoint.poisoned.has(key)) {
      console.log(`  [${item.id.padEnd(40)}] POISONED - skipped, not scored`);
      continue;
    }
    const prior = checkpoint.results.get(key);
    let outcome: CodeOutcome;
    let emitted: string;
    if (prior) {
      ({ outcome, emitted } = prior);
    } else {
      if (checkpointPath)
        appendFileSync(
          checkpointPath,
          `${JSON.stringify({ kind: "attempt", id: item.id, config: label })}\n`
        );
      // One fresh manifold per item: the primed terrain is identical for every
      // item, but a query still mints precepts, so a shared engine would let
      // item N-1 leak into item N. Boot is ~1s with LogicAtomizer, so isolation
      // is affordable and there is no reason to trade it away.
      const engine = await boot(cfg.corpus === "stdlib");
      try {
        const intent =
          cfg.surface === "name"
            ? nameSurface(item.entryPoint)
            : docSurface(item.prompt);
        emitted = await ask(engine.traveler, intent);
      } finally {
        await engine.close();
      }
      if (isAbstention(emitted)) {
        outcome = "abstain";
      } else {
        const { preamble, candidate } = splice(item, emitted);
        outcome = executeCandidate(preamble, candidate, item.tests).outcome;
      }
      if (checkpointPath) {
        const rec: CheckpointRecord = {
          kind: "result",
          id: item.id,
          config: label,
          outcome,
          emitted,
        };
        appendFileSync(checkpointPath, `${JSON.stringify(rec)}\n`);
      }
    }
    outcomes.push(outcome);
    console.log(
      `  [${item.id.padEnd(40)}] ${outcome.padEnd(8)} ${JSON.stringify(emitted).slice(0, 60)}${prior ? " (checkpoint)" : ""}`
    );
  }
  return scoreCode(outcomes);
}

// ---------------------------------------------------------------------------
// Mode: verified synthesis (the toolkit)
// ---------------------------------------------------------------------------

/**
 * Can any composition the current library can express pass a real problem?
 *
 * The engine is handed the problem's own doctests as a goal, assembles
 * candidates from the vault, and executes each against them - committing only
 * what passes (`verifiedSynthesis`). Then the survivor is scored the ordinary
 * way, against the OFFICIAL test suite.
 *
 * **The goal and the score are deliberately different artifacts.** Optimizing
 * against the examples and then scoring on the examples would be smuggling of
 * exactly the kind PARITY §4.5 warns about. They do overlap - HumanEval's
 * suites generally include the doctest cases - so a candidate that satisfies
 * only the examples will usually still fail the fuller suite, which is the
 * asymmetry that makes the comparison informative rather than circular.
 *
 * Reported separately from pass@1: `verified` counts candidates the engine
 * accepted, `pass` counts those the official tests agree with. The gap between
 * them is the toolkit lying to itself.
 */
async function runToolkit(items: CodeItem[]): Promise<CodeScore> {
  console.log("\n== humaneval-ts [toolkit: verified synthesis] ==\n");
  const outcomes: CodeOutcome[] = [];
  let verified = 0;
  let noExamples = 0;

  // The candidate pool is the Stage-1 corpus, identical for every item, and
  // building it touches nothing the queries can perturb (listCodePatterns is a
  // read; no precepts are minted). So one boot for the whole sweep, unlike the
  // perception-path modes above, where a shared engine would leak item to item.
  const engine = await boot(true);
  const pool = await candidatePool(engine.store);
  console.log(`  candidate pool: ${pool.length} patterns\n`);

  try {
    for (const item of items) {
      const examples = parseExamples(item.prompt);
      if (examples.length === 0) noExamples++;

      const result = await verifiedSynthesis(
        engine.store,
        item.entryPoint,
        examples,
        { candidates: pool }
      );

      let outcome: CodeOutcome;
      if (!result) {
        outcome = "abstain";
      } else {
        verified++;
        const { preamble, candidate } = splice(item, result.source);
        outcome = executeCandidate(preamble, candidate, item.tests).outcome;
      }
      outcomes.push(outcome);
      console.log(
        `  [${item.id.padEnd(40)}] ${outcome.padEnd(8)} ex=${String(examples.length).padStart(2)}` +
          (result ? `  <- ${result.signature} (of ${result.attempts})` : "")
      );
    }
  } finally {
    await engine.close();
  }

  const score = scoreCode(outcomes);
  console.log(
    `\n  self-verified: ${verified}/${items.length}   official-pass: ${score.buckets.pass}/${items.length}` +
      `   items with no examples: ${noExamples}`
  );
  return score;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(label: string, s: CodeScore): void {
  const b = s.buckets;
  console.log(
    `  ${label.padEnd(22)} pass@1=${(s.passAt1 * 100).toFixed(1).padStart(5)}%  ` +
      `abstain=${(s.abstentionRate * 100).toFixed(1).padStart(5)}%  ` +
      `confFalse=${String(s.confidentFalsehoods).padStart(3)}  n=${s.n}\n` +
      `  ${" ".repeat(22)} buckets: pass=${b.pass} fail=${b.fail} invalid=${b.invalid} timeout=${b.timeout} abstain=${b.abstain}`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : null;
}

async function main(): Promise<void> {
  const wantRoundTrip = process.argv.includes("--roundtrip");
  const wantHumanEval = process.argv.includes("--humaneval");
  const wantToolkit = process.argv.includes("--toolkit");
  const runAll = !wantRoundTrip && !wantHumanEval && !wantToolkit;
  // runAll implies every mode; the toolkit is opt-in alongside the others.
  const limit = Number(argValue("--limit") ?? 0);
  const checkpointPath = argValue("--checkpoint");
  const pin = process.argv.includes("--pin");

  const scores: Record<string, CodeScore> = {};

  if (runAll || wantRoundTrip) {
    scores.roundtrip = await runRoundTrip(limit);
  }

  if (runAll || wantToolkit) {
    const dataPath = join(
      import.meta.dirname ?? __dirname,
      "..",
      "..",
      "data",
      "benchmarks",
      "humaneval_ts.jsonl"
    );
    const all = loadItems(dataPath);
    scores.toolkit = await runToolkit(limit > 0 ? all.slice(0, limit) : all);
  }

  if (runAll || wantHumanEval) {
    const dataPath = join(
      import.meta.dirname ?? __dirname,
      "..",
      "..",
      "data",
      "benchmarks",
      "humaneval_ts.jsonl"
    );
    if (!existsSync(dataPath)) {
      console.error(
        `\nhumaneval_ts.jsonl not found at ${dataPath}\n` +
          `Run: tsx scripts/dev/fetch_code_benchmark.ts`
      );
      process.exit(1);
    }
    const all = loadItems(dataPath);
    const items = limit > 0 ? all.slice(0, limit) : all;
    const only = argValue("--corpus");
    const configs: HumanEvalConfig[] = [
      { corpus: "none", surface: "name" },
      { corpus: "stdlib", surface: "name" },
      { corpus: "stdlib", surface: "doc" },
    ].filter(c => !only || c.corpus === only) as HumanEvalConfig[];
    for (const cfg of configs) {
      scores[`humaneval.${cfg.corpus}.${cfg.surface}`] = await runHumanEval(
        items,
        cfg,
        checkpointPath
      );
    }
  }

  console.log("\n== summary ==\n");
  for (const [label, s] of Object.entries(scores)) report(label, s);

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
  const prev = baseline.codeSynthesis as
    | { date: string; scores: Record<string, CodeScore> }
    | undefined;

  if (prev && limit <= 0) {
    let regressions = 0;
    for (const [label, prevScore] of Object.entries(prev.scores)) {
      const now = scores[label];
      if (!now) continue;
      if (now.passAt1 < prevScore.passAt1 - 1e-9) {
        console.error(
          `REGRESSION: ${label} pass@1 ${(prevScore.passAt1 * 100).toFixed(1)}% -> ${(now.passAt1 * 100).toFixed(1)}%`
        );
        regressions++;
      }
      if (now.confidentFalsehoods > prevScore.confidentFalsehoods) {
        console.error(
          `REGRESSION: ${label} confidentFalsehoods ${prevScore.confidentFalsehoods} -> ${now.confidentFalsehoods} (the characteristic failure must remain silence)`
        );
        regressions++;
      }
    }
    if (regressions > 0 && !process.argv.includes("--accept")) {
      console.error(`\n${regressions} regression(s) detected.`);
      process.exit(1);
    }
    if (regressions === 0)
      console.log("\nNo regressions vs codeSynthesis baseline.");
  } else if (!prev && limit <= 0) {
    console.log("\nFirst code-synthesis run - scores written to baseline.");
  }

  if (pin && limit <= 0) {
    // A mode-filtered run knows nothing about the modes it skipped, so writing
    // its `scores` wholesale would DELETE their pins - silently retiring the
    // regression surface that protects them. (It did exactly that once: a
    // `--toolkit --pin` run left the baseline holding only `toolkit`.) The pin
    // is therefore merged, and a mode absent from this run keeps whatever it
    // was last measured at rather than vanishing.
    const prevScores = prev?.scores ?? {};
    const merged = { ...prevScores, ...scores };
    const skipped = Object.keys(prevScores).filter(k => !(k in scores));
    if (skipped.length > 0)
      console.log(`  [pin] carried forward unmeasured: ${skipped.join(", ")}`);
    baseline.codeSynthesis = { date: new Date().toISOString(), scores: merged };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`Baseline updated: ${BASELINE_PATH}`);
  } else {
    console.log(
      "\nBaseline NOT updated (pass --pin on a full run to move it)."
    );
  }
}

if (process.argv[1]?.includes("code_benchmark")) {
  main()
    .catch(e => {
      console.error(e);
      process.exitCode = 1;
    })
    // The engine holds live native handles (DuckDB, GPU) after the last await;
    // without this the run finishes and then sits forever.
    .finally(() => process.exit(process.exitCode ?? 0));
}
