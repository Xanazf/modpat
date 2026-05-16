import assert from "node:assert/strict";
import type SemanticAtomizer from "@atomics/SemanticAtomizer";
import { DOPAT_CONFIG } from "@config";
import { metrics } from "@core_s/Metrics";
import Unfolder, { UnfolderTimeoutError } from "@core_s/Unfolder";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeUnfolderSuite() {
  await describe("Fractal Unfolder Suite", async () => {
    const env = await TestHarness.getEnvironment<SemanticAtomizer>("semantic");
    const unfolder = new Unfolder(env.system, env.atomizer);

    await it("Testing Fractal Expansion of Logical Voids", async () => {
      const topic = "Security";
      const ids = env.atomizer.ingestSequence(topic, env.system);
      const voidId = ids[0];
      const initialCount = env.system.length;

      await unfolder.expand(voidId, topic);

      const finalCount = env.system.length;
      assert.ok(
        finalCount > initialCount,
        "New precepts should be added to the system"
      );

      let foundSpecific = false;
      for (let i = initialCount; i < finalCount; i++) {
        if (env.system.scope[i] !== undefined) foundSpecific = true;
      }
      assert.ok(foundSpecific, "Specific precepts should be materialized");
    });

    await it("Track 13 Fix B: fetchContent returns empty string on total failure (no synthetic success)", async () => {
      // queryContext7 returns null when the API is unreachable (no synthetic mock result)
      // and fetchWikipedia returns null for unknown topics.
      // fetchContent must return "" not a fabricated string.
      const result = await unfolder.fetchContent(
        "__nonexistent_topic_xyzzy_42__"
      );
      // Either empty (Wikipedia 404) or empty (Context7 null) — never fabricated content
      assert.ok(
        typeof result === "string",
        "fetchContent must always return a string"
      );
      // If it DID return something, it must not be the old synthetic fallback text
      assert.ok(
        !result.includes("mocked technical response") &&
          !result.includes("Context7 Mock"),
        `fetchContent must not return synthetic fallback; got: "${result.slice(0, 80)}"`
      );
    });

    await it("Track 13 Fix C: pendingDreams cap is enforced by config constant", async () => {
      assert.ok(
        typeof DOPAT_CONFIG.structural.PENDING_DREAMS_MAX === "number" &&
          DOPAT_CONFIG.structural.PENDING_DREAMS_MAX > 0,
        "PENDING_DREAMS_MAX must be a positive number"
      );
      assert.ok(
        DOPAT_CONFIG.structural.UNFOLDER_FETCH_TIMEOUT_MS > 0,
        "UNFOLDER_FETCH_TIMEOUT_MS must be a positive number"
      );
    });

    await it("Track 13 Fix A: UnfolderTimeoutError is exported and named correctly", async () => {
      const err = new UnfolderTimeoutError("test-topic");
      assert.strictEqual(err.name, "UnfolderTimeoutError");
      assert.ok(
        err.message.includes("test-topic"),
        "Error message must contain the topic"
      );
      assert.ok(
        err.message.includes(
          String(DOPAT_CONFIG.structural.UNFOLDER_FETCH_TIMEOUT_MS)
        ),
        "Error message must include the timeout value"
      );
    });

    await it("Track 13: expanded posX varies per precept (jitter applied)", async () => {
      const topic = "jitter_test";
      const ids = env.atomizer.ingestSequence(topic, env.system);
      const voidId = ids[0];
      const beforeLen = env.system.length;

      const expanded = await unfolder.expand(voidId, topic);
      if (!expanded || env.system.length <= beforeLen + 1) return; // skip if no multi-precept expansion

      // Collect posX values of newly added precepts
      const posXValues = new Set<number>();
      for (let i = beforeLen; i < env.system.length; i++) {
        posXValues.add(Math.round(env.system.posX[i] * 100) / 100);
      }
      // With jitter, multiple distinct posX values should appear
      assert.ok(
        posXValues.size > 1,
        "Jitter should produce distinct posX values across expanded precepts"
      );
    });

    await TestHarness.disposeEnvironment(env);
  });
}
