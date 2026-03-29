import assert from "node:assert/strict";
import * as fs from "node:fs";
import { BRAIN_CONFIG } from "@config";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeUMAPSuite() {
  await describe("UMAP & 4D Processing Suite", async () => {
    const env = await TestHarness.getEnvironment("base");

    await it("Testing UMAPLoader Word Mapping", async () => {
      if (!fs.existsSync(BRAIN_CONFIG.DOD_EMBEDDING.UMAP_BINARY_PATH)) {
        logger.warn("UMAP binary not found, skipping UMAPLoader tests");
        return;
      }

      // @ts-expect-error - accessing private loader
      const loader = env.atomizer.loader;
      const oovScope = loader.getScope("nonexistentword12345");
      assert.ok(oovScope >= 50000.0);
    });

    await it("Testing 4D Manifold Resolution (Matter vs Coordinate Layers)", async () => {
      const text = "Socrates is mortal |- Socrates is mortal";
      const ids = env.atomizer.ingestSequence(text, env.system);

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        // Coordinate Layer check
        assert.notStrictEqual(env.system.posX[id], 0, "posX missing");
        // posY can be 0 for the first token (i=0)
        if (i > 0) assert.notStrictEqual(env.system.posY[id], 0, `posY missing for token ${i}`);
        assert.notStrictEqual(env.system.posZ[id], 0, "posZ missing");
        // posW can be 0 for the first context
        if (i > 0) assert.ok(env.system.posW[id] >= 0, "posW invalid");

        // Matter Layer check
        assert.notStrictEqual(env.system.mass[id], 0, "mass missing");
        assert.notStrictEqual(env.system.scope[id], 0, "scope missing");
        assert.notStrictEqual(env.system.depth[id], 0, "depth missing");
        // time (age) can be 0 for initial tokens
      }
    });

    await TestHarness.disposeEnvironment(env);
  });
}
