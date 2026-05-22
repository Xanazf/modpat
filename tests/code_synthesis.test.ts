import assert from "node:assert/strict";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import { createTestTraveler } from "@core_i/Runtime";
import { SlotType } from "@core_i/System";
import { Synthesizer } from "@skill_code/Coder";
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
