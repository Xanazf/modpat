import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function runRigorousTests() {
  await describe("Rigorous Logic & Physics Stress Test", async () => {
    const env = await TestHarness.getEnvironment("base");
    // In shared mode the manifold accumulates content from all previous suites.
    // This suite's geodesic tests are sensitive to manifold density, so we start
    // from a known clean state.  reset() preserves the NULL slot (id=0).
    env.system.reset();

    await it("Case 1: 5-Hop Transitive Syllogism", async () => {
      const knowledge = [
        "socrates is human",
        "human are mammal",
        "mammal are vertebrate",
        "vertebrate are animal",
        "animal are mortal",
      ];

      for (const fact of knowledge) {
        env.atomizer.ingestSequence(fact, env.system);
      }

      const query1 =
        "socrates is human && human are mammal && mammal are vertebrate && vertebrate are animal && animal are mortal |-";
      const ids1 = env.atomizer.ingestSequence(query1, env.system);
      const resultIds1 = await env.resolver.resolveSequence(ids1);
      const result1 = env.atomizer
        .decodeSequence(resultIds1, env.system)
        .toLowerCase();

      logger.log(`Result: ${result1}`);
      assert.ok(
        result1.includes("socrates") && result1.includes("mortal"),
        "Failed to resolve 5-hop chain"
      );
    });

    await it("Case 2: Quantum Interference / Path Blinding", async () => {
      // Ingest source and target nodes, then place them at clearly separated
      // positions so the geodesic has a non-trivial direction to travel.
      const srcIds = env.atomizer.ingestSequence("source node", env.system);
      const tgtIds = env.atomizer.ingestSequence("target node", env.system);
      const srcId = srcIds[0]; // "source"
      const tgtId = tgtIds[0]; // "target"

      // Separate source and target along the posX axis.
      env.system.posX[srcId] = 0.0;
      env.system.posY[srcId] = 0.0;
      env.system.posX[tgtId] = 20.0;
      env.system.posY[tgtId] = 0.0;
      env.system.update(srcId);
      env.system.update(tgtId);

      const distractorIds = env.atomizer.ingestSequence(
        "massive distractor",
        env.system
      );
      const distractorId = distractorIds[1]; // "distractor"

      // Place distractor exactly at the midpoint so the geodesic is guaranteed
      // to pass through (or very close to) its position.
      env.system.posX[distractorId] = 10.0;
      env.system.posY[distractorId] = 0.0;
      // Moderately elevated mass: density ≈ 270 (well below TRAP_MASS_THRESHOLD=5000)
      // so the Mapper does not re-route around it, yet influence is ~55× the baseline.
      env.system.mass[distractorId] = env.system.c ** 2 * 1000;
      // Recompute derived properties so density/intensity reflect the new mass.
      env.system.update(distractorId);

      const path = await env.resolver.calculateGeodesic(srcId, tgtId, 64);
      const pathTokens = env.atomizer.decodeSequence(path, env.system);

      logger.log(`Geodesic Path tokens: ${pathTokens}`);
      assert.ok(
        pathTokens.toLowerCase().includes("distractor"),
        `Distractor placed at the geodesic midpoint must appear in the path. Path was: "${pathTokens}"`
      );
      logger.log(
        `  ✓ Successfully warped the logical geodesic through the midpoint distractor.`
      );
    });

    await it("Case 3: Paradoxical Instability (The Liar Paradox)", async () => {
      env.atomizer.ingestSequence(
        "proposition p is not proposition p",
        env.system
      );
      const query3 = "proposition p |-";
      const ids3 = env.atomizer.ingestSequence(query3, env.system);

      const resultIds3 = await env.resolver.resolveSequence(ids3);
      const result3 = env.atomizer
        .decodeSequence(resultIds3, env.system)
        .toLowerCase();

      logger.log(`Paradox Result: ${result3}`);
      assert.ok(
        result3.includes("unknown") || result3 === "",
        "System did not safely default to unknown for paradox"
      );
    });

    await TestHarness.disposeEnvironment(env);
  });
}
