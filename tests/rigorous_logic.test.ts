import assert from "node:assert/strict";
import logger from "@src/utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function runRigorousTests() {
  await describe("Rigorous Logic & Physics Stress Test", async () => {
    const env = await TestHarness.getEnvironment("base");

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
      env.atomizer.ingestSequence(
        "point alpha leads to point beta",
        env.system
      );
      const alphaId = env.atomizer.ingestSequence("point alpha", env.system)[0];
      const betaId = env.atomizer.ingestSequence("point beta", env.system)[0];

      const distractorIds = env.atomizer.ingestSequence(
        "massive distractor",
        env.system
      );
      const distractorId = distractorIds[1];

      env.system.posX[distractorId] = env.system.posX[alphaId] + 1.0;
      env.system.posY[distractorId] = env.system.posY[alphaId] + 1.0;
      env.system.mass[distractorId] = env.system.c ** 2 * 1000000.0;

      const path = await env.resolver.calculateGeodesic(alphaId, betaId, 64);
      const pathTokens = env.atomizer.decodeSequence(path, env.system);

      logger.log(`Geodesic Path tokens: ${pathTokens}`);
      if (!pathTokens.toLowerCase().includes("distractor")) {
        logger.warn(
          `  ⚠ Distractor did not warp the logical geodesic. Path: "${pathTokens}"`
        );
      } else {
        logger.log(
          `  ✓ Successfully warped the logical geodesic with mass distractor.`
        );
      }
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
