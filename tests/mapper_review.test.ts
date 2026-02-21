import assert from "node:assert";
import { GeodesicMapper } from "@src/core/integral/Mapper";
import logger from "@src/utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function runMapperReviewTest() {
  await describe("Mapper Review Suite", async () => {
    const env = await TestHarness.getEnvironment("semantic");

    await it("GeodesicMapper Self-Review & Self-Correction", async () => {
      const alphaId = env.atomizer.ingestSequence("alpha", env.system)[0];
      const betaId = env.atomizer.ingestSequence("beta", env.system)[0];

      env.system.posX[alphaId] = 0;
      env.system.posY[alphaId] = 0;
      env.system.entropy[alphaId] = 0.5;

      env.system.posX[betaId] = 100;
      env.system.posY[betaId] = 0;
      env.system.entropy[betaId] = 0.5;

      const trapId = env.atomizer.ingestSequence("trap", env.system)[0];
      env.system.posX[trapId] = 50;
      env.system.posY[trapId] = 0;
      env.system.mass[trapId] = env.system.c ** 2 * 1000.0;
      env.system.entropy[trapId] = 0.0;

      const mapper = new GeodesicMapper(env.system);
      const path = await mapper.route(alphaId, betaId, {
        steps: 32,
        verbose: true,
      });

      const pathTokens = env.atomizer.decodeSequence(path, env.system);
      logger.log(`Calculated Path: ${pathTokens}`);
      assert.ok(!pathTokens.toLowerCase().includes("trap"));
    });

    await TestHarness.disposeEnvironment(env);
  });
}
