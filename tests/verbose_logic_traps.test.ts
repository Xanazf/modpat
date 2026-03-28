import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function runRigorousTraps() {
  await describe("Physics-Based Logic: Advanced Stress Suite", async () => {
    const env = await TestHarness.getEnvironment("base");

    await it("Trap 1: The Transitive Horizon (10-Hop Chain)", async () => {
      const alphabet = "abcdefghijk".split("");
      for (let i = 0; i < alphabet.length - 1; i++) {
        env.atomizer.ingestSequence(
          `${alphabet[i]} is ${alphabet[i + 1]}`,
          env.system
        );
      }

      const query1 =
        "a is b && b is c && c is d && d is e && e is f && f is g && g is h && h is i && i is j && j is k |-";
      const ids1 = env.atomizer.ingestSequence(query1, env.system);
      const resultIds1 = await env.resolver.resolveSequence(ids1);
      const result1 = env.atomizer
        .decodeSequence(resultIds1, env.system)
        .toLowerCase();

      logger.log(`Inquiry: A -> K (10 Hops), Result: ${result1}`);
      assert.ok(
        result1.includes("k") || result1.includes("j"),
        "Significant signal decay"
      );
    });

    await it("Trap 2: Recursive Feedback Loop", async () => {
      env.atomizer.ingestSequence("object_alpha is object_beta", env.system);
      env.atomizer.ingestSequence("object_beta is object_alpha", env.system);

      const query2 = "object_alpha |-";
      const ids2 = env.atomizer.ingestSequence(query2, env.system);
      const resultIds2 = await env.resolver.resolveSequence(ids2);
      const result2 = env.atomizer.decodeSequence(resultIds2, env.system);

      logger.log(`Inquiry: Resolve Alpha in Loop, Result: ${result2}`);
      assert.ok(result2.length > 0, "System failed to stabilize in loop");
    });

    await it("Trap 3: Shadow Inference (Memory-Augmented)", async () => {
      env.atomizer.ingestSequence("mars is red_planet", env.system);
      env.atomizer.ingestSequence("red_planet is cold", env.system);

      const query3 = "mars is";
      const ids3 = env.atomizer.ingestSequence(query3, env.system);
      const resultIds3 = await env.resolver.resolveSequence(ids3);
      const result3 = env.atomizer
        .decodeSequence(resultIds3, env.system)
        .toLowerCase();

      logger.log(`Inquiry: Mars is ... (Memory-heavy), Result: ${result3}`);
      assert.ok(
        result3.includes("red_planet") || result3.includes("cold"),
        "Shadow inference failed"
      );
    });

    await it("Trap 4: False Symmetry (Undistributed Middle)", async () => {
      env.atomizer.ingestSequence("bat is mammal", env.system);
      env.atomizer.ingestSequence("cat is mammal", env.system);

      const query4 = "bat is mammal && cat is mammal |-";
      const ids4 = env.atomizer.ingestSequence(query4, env.system);
      const resultIds4 = await env.resolver.resolveSequence(ids4);
      const result4 = env.atomizer
        .decodeSequence(resultIds4, env.system)
        .toLowerCase();

      logger.log(`Inquiry: Bat vs Cat via Mammal, Result: ${result4}`);
      // Success if 'bat' is NOT linked directly to 'cat'
      const fallacy = result4.includes("bat") && result4.includes("cat");
      assert.ok(!fallacy, "Undistributed Middle fallacy detected");
    });

    await TestHarness.disposeEnvironment(env);
  });
}
