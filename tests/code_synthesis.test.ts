import assert from "node:assert/strict";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import { createTestTraveler } from "@core_i/Runtime";
import { SlotType } from "@core_i/System";
import { runTypeScript } from "@core_s/grounding/CodeBehaviouralFidelity";
import { detokenizeCode, Synthesizer } from "@skill_code/Coder";
import { parseExamples, verificationProgram } from "@skill_code/Toolkit";
import { logger } from "@src/utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeCodeSynthesisSuite() {
  await describe("CODE SYNTHESIS SUITE", async () => {
    // Test 1: processCode ingests patterns into wave_forms
    await it("Test 1: processCode crystallizes patterns from source code", async () => {
      const env =
        await TestHarness.getEnvironment<SemanticAtomizer>("semantic");
      const { system, atomizer, store, resolver } = env;

      const inference = createTestTraveler(system, atomizer, resolver, store);

      const source = `
        function add(a, b) { return a + b; }
        function subtract(a, b) { return a - b; }
        const double = (x) => x * 2;
        function clamp(score) { if (score > 0) { return score; } return 0; }
      `;

      const result = await inference.processCode(source);
      assert.match(
        result,
        /Ingested \d+ code patterns/,
        "Should report ingested patterns"
      );

      // Verify wave_forms has entries with non-zero slot_flags
      const stmt = await store.connection.prepare(
        `SELECT COUNT(*) FROM wave_forms WHERE slot_flags != 0`
      );
      const res = await stmt.runAndReadAll();
      stmt.destroySync();
      const count = Number(res.getRows()[0][0]);
      assert.ok(
        count > 0,
        `Expected at least 1 pattern with slot_flags set, got ${count}`
      );

      await TestHarness.disposeEnvironment(env);
    });

    // Test 2: Synthesizer.compose fills continuation slots correctly
    await it("Test 2: Synthesizer.compose nests patterns outer→inner", async () => {
      const synth = new Synthesizer();

      // packSlotFlags manually: Body=0b00010=2, Leaf=0b00001=1
      // VAR_0=Leaf(1), VAR_1=Parameter(8), VAR_BODY=Body(2) for var index 2
      const outerFlags = 1n | (8n << 5n) | (2n << 10n); // VAR_0=Leaf, VAR_1=Param, VAR_2=Body

      const outer = {
        template: "function VAR_0(VAR_1) { VAR_2 }",
        slotFlags: outerFlags,
      };
      const inner = { template: "return VAR_0 + VAR_1", slotFlags: 0n };

      const composed = synth.compose([outer, inner]);
      assert.ok(
        composed.includes("function") && composed.includes("return"),
        `Composed output should contain both patterns, got: "${composed}"`
      );
      assert.ok(
        !composed.includes("VAR_2"),
        "Body slot VAR_2 should have been replaced by the inner pattern"
      );
      logger.log(composed);
    });

    // Test 3: Synthesizer.instantiate binds concrete tokens
    await it("Test 3: Synthesizer.instantiate replaces VARs with concrete tokens", async () => {
      const synth = new Synthesizer();
      const template = "function VAR_0(VAR_1, VAR_2) { return VAR_1 + VAR_2; }";
      const bindings = new Map<number, string>([
        [0, "add"],
        [1, "a"],
        [2, "b"],
      ]);
      const result = synth.instantiate(template, bindings);
      assert.strictEqual(
        result,
        "function add(a, b) { return a + b; }",
        "Instantiated code should replace all VARs with bound tokens"
      );
      logger.log(result);
    });

    //  Test 4: ingestPattern sets slotType on VAR precepts
    await it("Test 4: ingestPattern sets slotType correctly on manifold precepts", async () => {
      const env =
        await TestHarness.getEnvironment<SemanticAtomizer>("semantic");
      const { system, atomizer } = env;

      const slotTypes = new Map<number, SlotType>([
        [0, SlotType.Leaf],
        [1, SlotType.Parameter],
        [2, SlotType.Body],
      ]);

      const ids = atomizer.ingestPattern(
        "function VAR_0(VAR_1) { VAR_2 }",
        slotTypes,
        system
      );

      const var0Id = ids.find(id => {
        const decoded = atomizer
          .decodeSequence(new Uint32Array([id]), system)
          .trim();
        return decoded === "var_0";
      });
      const var2Id = ids.find(id => {
        const decoded = atomizer
          .decodeSequence(new Uint32Array([id]), system)
          .trim();
        return decoded === "var_2";
      });

      if (var0Id !== undefined) {
        assert.strictEqual(
          system.slotType[var0Id] & SlotType.Leaf,
          SlotType.Leaf,
          "VAR_0 should have Leaf SlotType"
        );
      }
      if (var2Id !== undefined) {
        assert.strictEqual(
          system.slotType[var2Id] & SlotType.Body,
          SlotType.Body,
          "VAR_2 should have Body SlotType"
        );
      }

      await TestHarness.disposeEnvironment(env);
    });

    // Test 5a: double-slot substitution, VAR_0 used more than once
    await it("Test 5a: instantiate replaces VAR_0 everywhere it appears", async () => {
      const synth = new Synthesizer();
      const template = "function f(VAR_0) { return VAR_0 + 1; }";
      const bindings = new Map<number, string>([[0, "x"]]);
      const result = synth.instantiate(template, bindings);
      assert.strictEqual(
        result,
        "function f(x) { return x + 1; }",
        "Every occurrence of VAR_0 must be replaced"
      );
      assert.ok(
        !result.includes("VAR_0"),
        "No VAR_0 placeholder should remain"
      );
    });

    // Test 5b: compose with empty list returns ""
    await it("Test 5b: compose([]) returns empty string", async () => {
      const synth = new Synthesizer();
      assert.strictEqual(
        synth.compose([]),
        "",
        "compose of empty pattern list must be empty string"
      );
    });

    // Test 5c: instantiate with unbound VAR produces underscore placeholder
    await it("Test 5c: instantiate with unbound VAR produces '_'", async () => {
      const synth = new Synthesizer();
      const template = "const VAR_0 = VAR_1 + VAR_2;";
      const bindings = new Map<number, string>([[0, "result"]]);
      const result = synth.instantiate(template, bindings);
      assert.strictEqual(
        result,
        "const result = _ + _;",
        "Unbound VARs should become '_'"
      );
    });

    // Test 6: the detokenizer inverts every loss ingestion imposes on code.
    //
    // These are the exact decoded forms the manifold produces (verified against
    // `decodeSequence` output), so this pins the emission contract without
    // needing a live vault: each case is one of the three losses PARITY §3.5
    // measured, and together they are why round-trip pass@1 was 0%.
    await it("Test 6: detokenizeCode inverts the manifold's code losses", async () => {
      // Loss 1: operator words. Ingestion maps "+" to "plus" so that "1 + 1"
      // and "1 plus 1" share a scope - correct for arithmetic, fatal for source.
      assert.strictEqual(
        detokenizeCode(
          "return var_0 plus var_1",
          new Map([
            [0, "a"],
            [1, "b"],
          ])
        ),
        "return a + b;",
        "operator words must come back as symbols"
      );

      // Loss 2: case. `toUpperCase` decodes as `touppercase` and cannot be
      // restored mechanically - only the stored slot name carries it.
      assert.strictEqual(
        detokenizeCode(
          "function var_0 ( var_1 ) { return var_1 . var_2 ( ) ; }",
          new Map([
            [0, "upper"],
            [1, "s"],
            [2, "toUpperCase"],
          ])
        ),
        "function upper(s) {\n  return s.toUpperCase();\n}",
        "slot names must restore identifier case, including member names"
      );

      // Loss 3: spacing. JavaScript is whitespace-insensitive, so the
      // space-joined form already parses and `generate` re-prints it.
      assert.strictEqual(
        detokenizeCode(
          "function var_0 ( var_1 , var_2 ) { if ( var_1 > var_2 ) { return var_1 ; } return var_2 ; }",
          new Map([
            [0, "greaterOf"],
            [1, "a"],
            [2, "b"],
          ])
        ),
        "function greaterOf(a, b) {\n  if (a > b) {\n    return a;\n  }\n  return b;\n}",
        "space-joined tokens must re-print as canonical source"
      );

      // `=` is canonicalized too, and only as a bare token - `===` survives
      // ingestion intact and must NOT be rewritten.
      assert.strictEqual(
        detokenizeCode(
          "return var_0 === var_1",
          new Map([
            [0, "a"],
            [1, "b"],
          ])
        ),
        "return a === b;",
        "=== must pass through untouched"
      );

      // An unbound slot stays a legal identifier rather than becoming `_`, so
      // the parse judges STRUCTURE and a missing name never fakes a failure.
      assert.ok(
        detokenizeCode("return var_0 plus var_1"),
        "an unbound slot must still yield a program"
      );

      // The verdict half of the contract: anything that does not parse is null,
      // which the caller turns into an abstention (PARITY §1 - the
      // characteristic failure must be silence, not a confident falsehood).
      for (const bad of [
        "two numbers closer to each other than given threshold",
        "function var_0 ( var_1 var_2 ) { return var_1 ; }", // comma lost
        "unknown",
        "",
      ]) {
        assert.strictEqual(
          detokenizeCode(bad),
          null,
          `non-program must be refused, not committed: "${bad}"`
        );
      }
    });

    // Test 7: the toolkit's goal parser and its specification floor.
    await it("Test 7: parseExamples reads doctests; the verifier needs a real spec", async () => {
      const prompt = [
        "//Check if any two numbers are closer than the threshold.",
        "// >>> has_close_elements([1.0, 2.0], 0.5)",
        "// false",
        "// >>> has_close_elements([1.0, 2.8, 3.0], 0.3)",
        "// true",
        "function has_close_elements(numbers: number[], t: number): boolean {",
      ].join("\n");

      assert.deepStrictEqual(parseExamples(prompt), [
        { call: "has_close_elements([1.0, 2.0], 0.5)", expected: "false" },
        { call: "has_close_elements([1.0, 2.8, 3.0], 0.3)", expected: "true" },
      ]);

      // Prose above the examples is not an example, and parsing stops at the
      // signature - a stray `>>>` in code would otherwise become a phantom goal.
      assert.strictEqual(
        parseExamples("//just prose, no examples\nfunction f() {").length,
        0
      );

      // Expected values are TypeScript literals of every shape the corpus uses.
      const shapes = parseExamples(
        [
          "// >>> intersperse([], 4)",
          "// []",
          "// >>> longest([])",
          "// undefined",
          '// >>> longest(["a", "bb"])',
          '// "bb"',
          "function f() {",
        ].join("\n")
      );
      assert.deepStrictEqual(
        shapes.map(e => e.expected),
        ["[]", "undefined", '"bb"']
      );

      // The verification program must isolate candidates from each other: two
      // candidates declaring the same identifier must not collide, and the
      // first that satisfies the examples wins.
      const program = verificationProgram(
        [
          {
            source: "function f(a, b) { return a - b; }",
            declaredName: "f",
            signature: "wrong",
          },
          {
            source: "function f(a, b) { return a + b; }",
            declaredName: "f",
            signature: "right",
          },
        ],
        "f",
        [{ call: "f(2, 3)", expected: "5" }]
      );
      assert.ok(
        program.includes("__try0") && program.includes("__try1"),
        "each candidate gets its own scope"
      );
      const run = runTypeScript(program, 10_000);
      assert.strictEqual(
        run.stdout.trim(),
        "1",
        "the verifier must select the candidate that actually satisfies the examples"
      );
    });

    //  Test 5: pack/unpack slot flags round-trip
    await it("Test 5: packSlotFlags/unpackSlotFlags round-trips correctly", async () => {
      const env =
        await TestHarness.getEnvironment<SemanticAtomizer>("semantic");
      const { store } = env;

      const original = new Map<number, SlotType>([
        [0, SlotType.Leaf],
        [1, SlotType.Parameter],
        [2, SlotType.Body],
        [3, SlotType.Condition],
        [4, SlotType.TypeHint],
      ]);

      const packed = store.packSlotFlags(original);
      const unpacked = store.unpackSlotFlags(packed);

      for (const [varId, expected] of original) {
        assert.strictEqual(
          unpacked.get(varId),
          expected,
          `VAR_${varId} SlotType mismatch after round-trip`
        );
      }

      await TestHarness.disposeEnvironment(env);
    });
  });
}
