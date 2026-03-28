import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function runLogicTest() {
  await describe("Aristotelian & Quantum Logic Test Suite", async () => {
    const env = await TestHarness.getEnvironment("base");

    await it("Case 1: Aristotelian Syllogism (Barbara)", async () => {
      env.atomizer.ingestSequence("all human are mortal", env.system);
      env.atomizer.ingestSequence("socrates is human", env.system);

      const query1 = "socrates is human && all human are mortal |-";
      const ids1 = env.atomizer.ingestSequence(query1, env.system);
      const resultIds1 = await env.resolver.resolveSequence(ids1);
      const result1 = env.atomizer
        .decodeSequence(resultIds1, env.system)
        .toLowerCase();

      logger.log(`Inquiry: ${query1}`);
      logger.log(`Result:  ${result1}`);

      assert.ok(
        result1.includes("socrates") && result1.includes("mortal"),
        `Aristotelian Syllogism failed. Expected 'socrates is mortal', got '${result1}'`
      );
    });

    await it("Case 2: Quantum Logic Manifold (Geodesic Pathfinding)", async () => {
      env.atomizer.ingestSequence("the quantum object is wave", env.system);
      env.atomizer.ingestSequence("the quantum object is particle", env.system);

      const objIds = env.atomizer.ingestSequence(
        "the quantum object",
        env.system
      );
      const objId = objIds[1]; // Use 'quantum' instead of 'the'
      const waveId = env.atomizer.ingestSequence("wave", env.system)[0];
      const particleId = env.atomizer.ingestSequence("particle", env.system)[0];

      const path1 = await env.resolver.calculateGeodesic(objId, waveId);
      const path2 = await env.resolver.calculateGeodesic(objId, particleId);
      logger.log(`Default Wave Path Length:     ${path1.length}`);
      logger.log(`Default Particle Path Length: ${path2.length}`);

      assert.ok(path1.length > 0 && path2.length > 0);
    });

    await it("Case 3: Wave Collapse (Path Bias via Mass)", async () => {
      const objIds = env.atomizer.ingestSequence(
        "the quantum object",
        env.system
      );
      const objId = objIds[1];
      const waveId = env.atomizer.ingestSequence("wave", env.system)[0];
      const particleId = env.atomizer.ingestSequence("particle", env.system)[0];

      logger.log("Increasing 'particle' mass to 1000c^2 (Measurement Action)");
      const pIds = env.atomizer.ingestSequence("particle", env.system);
      for (const id of pIds) {
        env.system.mass[id] = env.system.c ** 2 * 1000.0;
      }

      const measuredPath1 = await env.resolver.calculateGeodesic(objId, waveId);
      const measuredPath2 = await env.resolver.calculateGeodesic(
        objId,
        particleId
      );

      logger.log(`Measured Wave Path Length:     ${measuredPath1.length}`);
      logger.log(`Measured Particle Path Length: ${measuredPath2.length}`);

      assert.ok(
        measuredPath2.length <= measuredPath1.length,
        "Geodesic failed to collapse toward high-mass state"
      );
    });

    await TestHarness.disposeEnvironment(env);
  });
}
