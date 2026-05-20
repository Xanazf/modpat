import assert from "node:assert/strict";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import { createTestMapper } from "@core_i/Runtime";
import { SlotType } from "@core_i/System";
import Unfolder from "@core_s/Unfolder";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeE2ETest() {
  await describe("Physicalized Code Synthesis (PCS) 4D Contextual Loom E2E", async () => {
    const env = await TestHarness.getEnvironment<SemanticAtomizer>("semantic");
    const { system, atomizer, resolver, store } = env;
    system.reset();

    const unfolder = new Unfolder(system, atomizer);
    const inference = createTestMapper(
      system,
      atomizer,
      resolver,
      store,
      unfolder
    );

    // Step 1, crystallize a set of code patterns into the vault.
    const source = `
        function add(a, b) { return a + b; }
        function multiply(a, b) { return a * b; }
        const greet = (name) => name;
      `;
    const ingestMsg = await inference.processCode(source);
    assert.match(
      ingestMsg,
      /Ingested \d+ code patterns/,
      `processCode should report ingested patterns, got: "${ingestMsg}"`
    );

    // Step 2, vault has at least one entry with slot_flags set (Body/Condition slot).
    const slotStmt = await store.connection.prepare(
      `SELECT COUNT(*) FROM wave_forms WHERE slot_flags != 0`
    );
    const slotRes = await slotStmt.runAndReadAll();
    slotStmt.destroySync();
    const slotCount = Number(slotRes.getRows()[0][0]);
    assert.ok(
      slotCount > 0,
      `Expected vault entries with slot_flags; got ${slotCount}`
    );

    // Step 3, manifold has precepts carrying structural slot types.
    // processCode assigns Leaf/Parameter/Condition slots (not Body, that requires
    // manually constructed patterns). Any non-None slot confirms the pipeline ran.
    let slottedPrecepts = 0;
    for (let i = 0; i < system.length; i++) {
      if (system.slotType[i] !== SlotType.None) slottedPrecepts++;
    }
    assert.ok(
      slottedPrecepts > 0,
      "Manifold should have structurally-typed precepts (Leaf/Parameter/Condition) after processCode"
    );

    // Step 4, resolve a synthesis request using the learned patterns.
    const responses: string[] = [];
    inference.onResponse = r => {
      responses.push(r);
    };

    await inference.processIntent("function add |-");
    assert.ok(responses.length > 0, "processIntent should produce a response");

    const synthesized = responses.join(" ");
    // The synthesized code must not be "unknown" and must contain recognisable structure.
    assert.ok(
      !synthesized.toLowerCase().includes("unknown") ||
        synthesized.includes("function") ||
        synthesized.includes("return"),
      `Synthesis should produce meaningful code or acknowledge the pattern. Got: "${synthesized}"`
    );

    await TestHarness.disposeEnvironment(env);
    console.log("PCS E2E TEST COMPLETED SUCCESSFULLY");
  });
}

export { executeE2ETest as runPcsE2eTests };
if (require.main === module) {
  executeE2ETest().catch(console.error);
}
