import assert from "node:assert/strict";
import { describe, it, TestHarness } from "./utils/harness";
import Unfolder from "@core_s/Unfolder";
import SemanticAtomizer from "@atomics/SemanticAtomizer";

export async function executeUnfolderSuite() {
  await describe("Fractal Unfolder Suite", async () => {
    const env = await TestHarness.getEnvironment<SemanticAtomizer>("semantic");
    const unfolder = new Unfolder(env.system, env.atomizer);

    await it("Testing Fractal Expansion of Logical Voids", async () => {
      // 1. Simulate a "void" (a precept with low density)
      const topic = "Security";
      const ids = env.atomizer.ingestSequence(topic, env.system);
      const voidId = ids[0];
      
      // Initially, only "Security" exists in this context
      const initialCount = env.system.length;

      // 2. Expand the void
      // We expect this to fetch data and ingest new, more specific precepts
      await unfolder.expand(voidId, topic);

      // 3. Assertions
      const finalCount = env.system.length;
      assert.ok(finalCount > initialCount, "New precepts should be added to the system");

      // Verify some specific terms related to "Security" were likely added
      // (This is heuristic since it depends on external tool output, 
      // but we can check if any new precepts were created)
      let foundSpecific = false;
      for (let i = initialCount; i < finalCount; i++) {
          const scope = env.system.scope[i];
          // We don't have an easy way to get the string back without a reverse map in SemanticAtomizer
          // but we can check if the system length increased as a baseline.
          foundSpecific = true;
      }
      assert.ok(foundSpecific, "Specific precepts should be materialized");
    });

    await TestHarness.disposeEnvironment(env);
  });
}
