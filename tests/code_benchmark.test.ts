/**
 * Guard tests for the code-synthesis benchmark harness (PARITY §3.5).
 *
 * The harness produces the number §3.5's estimate hangs off, so the harness
 * itself needs the same discipline the scoring mapper got (`runScoringSelftest`
 * in tests/benchmarks/scoring.ts): its rules are pinned by unit cases so it
 * cannot silently absorb the capability it is supposed to be measuring.
 *
 * Three things are guarded here, each for a different failure it prevents:
 *
 *  1. **Anti-smuggling.** No Stage-1 corpus function may share a name with a
 *     HumanEval entry point. If it ever did, a primed run would be scored on
 *     terrain that contains the answer - exactly the circularity PARITY §4.5
 *     warns about, and the kind that is invisible in the headline number.
 *  2. **The executor's verdicts.** pass / fail / invalid must stay distinct.
 *     Collapsing `invalid` into `fail` would erase the §3.5 diagnosis (an
 *     emission that does not parse is a different defect from one that runs and
 *     is wrong), and collapsing either into `abstain` would flatter the
 *     covenant metric by reclassifying garbage as silence.
 *  3. **The surfaces and the splice.** These decide what the engine is asked
 *     and how its answer is mounted; a bug in either would move the score
 *     without any engine change at all.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type CodeItem,
  docSurface,
  executeCandidate,
  isAbstention,
  nameSurface,
  scoreCode,
  splice,
} from "./benchmarks/code_benchmark";
import { corpusFunctionNames } from "./benchmarks/code_corpus";
import { describe, it } from "./utils/harness";

const ASSERT_PREAMBLE =
  "declare var require: any;\nconst assert = require('node:assert');\n";

function loadBenchmark(): CodeItem[] {
  const path = join(
    import.meta.dirname ?? __dirname,
    "..",
    "data",
    "benchmarks",
    "humaneval_ts.jsonl"
  );
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l) as CodeItem);
}

export async function executeCodeBenchmarkSuite() {
  await describe("CODE BENCHMARK HARNESS SUITE", async () => {
    await it("the Stage-1 corpus contains no HumanEval answer", async () => {
      const entryPoints = new Set(loadBenchmark().map(i => i.entryPoint));
      const collisions = corpusFunctionNames().filter(n => entryPoints.has(n));
      assert.deepStrictEqual(
        collisions,
        [],
        `Corpus functions collide with HumanEval entry points: ${collisions.join(", ")}. ` +
          `A primed run would then be scored on terrain containing the answer.`
      );
    });

    await it("the benchmark file is the full, well-formed MultiPL-E TS set", async () => {
      const items = loadBenchmark();
      assert.strictEqual(
        items.length,
        159,
        "expected all 159 humaneval-ts problems"
      );
      for (const i of items) {
        assert.ok(
          i.prompt.includes(i.entryPoint),
          `${i.id}: prompt lacks its entry point`
        );
        assert.ok(
          i.tests.includes("candidate"),
          `${i.id}: tests do not bind a candidate`
        );
      }
    });

    await it("the executor separates pass / fail / invalid", async () => {
      const pass = executeCandidate(
        ASSERT_PREAMBLE,
        "function f(a: number, b: number): number { return a + b; }",
        "assert.strictEqual(f(2,3),5);"
      );
      assert.strictEqual(pass.outcome, "pass", "correct code must pass");

      const fail = executeCandidate(
        ASSERT_PREAMBLE,
        "function f(a: number, b: number): number { return a - b; }",
        "assert.strictEqual(f(2,3),5);"
      );
      assert.strictEqual(
        fail.outcome,
        "fail",
        "code that runs and is wrong must be `fail`, never `invalid`"
      );

      // The characteristic emission of the current channel: operators come back
      // as their word forms, so the text does not parse (PARITY §3.5 baseline).
      const invalid = executeCandidate(
        ASSERT_PREAMBLE,
        "function f ( _ _ ) { return _ plus _ ; }",
        "assert.strictEqual(f(2,3),5);"
      );
      assert.strictEqual(
        invalid.outcome,
        "invalid",
        "an emission that does not parse must be `invalid`, never `fail`"
      );
    });

    await it("abstention is recognised only for non-commitment", async () => {
      for (const a of ["", "   ", "unknown", "I cannot determine that"])
        assert.ok(isAbstention(a), `"${a}" should read as abstention`);
      for (const a of [
        "function f() { return 1; }",
        "two numbers closer to each other than given threshold",
        "even",
      ])
        assert.ok(
          !isAbstention(a),
          `"${a}" is a commitment and must be scored as one`
        );
    });

    await it("scoreCode counts every committed non-pass as a confident falsehood", async () => {
      const s = scoreCode([
        "pass",
        "pass",
        "fail",
        "invalid",
        "timeout",
        "abstain",
        "abstain",
        "abstain",
      ]);
      assert.strictEqual(s.n, 8);
      assert.strictEqual(s.passAt1, 2 / 8);
      assert.strictEqual(s.abstentionRate, 3 / 8);
      assert.strictEqual(
        s.confidentFalsehoods,
        3,
        "fail + invalid + timeout are all commitments that did not hold"
      );
      assert.strictEqual(s.buckets.invalid, 1);
    });

    await it("the two question surfaces read as intended", async () => {
      assert.strictEqual(
        nameSurface("has_close_elements"),
        "function has close elements"
      );
      assert.strictEqual(nameSurface("belowZero"), "function below zero");

      const prompt =
        "//Check if in given array of numbers, are any two numbers closer\n" +
        "// than the given threshold.\n" +
        "// >>> has_close_elements([1.0, 2.0], 0.5)\n" +
        "// false\n" +
        "function has_close_elements(numbers: number[], threshold: number): boolean {\n";
      assert.strictEqual(
        docSurface(prompt),
        "Check if in given array of numbers, are any two numbers closer than the given threshold.",
        "the doc surface is the prose spec, with the doctest examples dropped"
      );
    });

    await it("splice mounts a body inline and a declaration standalone", async () => {
      const item: CodeItem = {
        id: "x",
        entryPoint: "target",
        prompt: "function target(a: number): number {\n",
        tests: "",
        stopTokens: [],
      };

      const body = splice(item, "  return a + 1;");
      assert.ok(
        body.preamble.includes("function target"),
        "a bare body is spliced into the official prompt"
      );
      assert.ok(body.candidate.trim().endsWith("}"), "and the body is closed");

      const decl = splice(item, "function other(a) { return a + 1; }");
      assert.strictEqual(
        decl.preamble,
        "",
        "a standalone declaration must not be nested inside the prompt"
      );
      assert.ok(
        decl.candidate.includes("const target = other;"),
        "and a differently-named declaration is aliased to the tested name"
      );

      // The alias must not be emitted when the names already agree, or the
      // spliced file would redeclare the identifier and every item would read
      // as `invalid` regardless of what the engine did.
      const same = splice(item, "function target(a) { return a + 1; }");
      assert.ok(!same.candidate.includes("const target ="), "no self-alias");
      assert.strictEqual(
        executeCandidate(
          ASSERT_PREAMBLE,
          same.candidate,
          "assert.strictEqual(target(1),2);"
        ).outcome,
        "pass",
        "a self-named declaration must still execute"
      );
    });
  });
}
