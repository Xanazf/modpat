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

    await it("Testing 4D Manifold Resolution (X, Y, Entropy, Time)", async () => {
      const text = "Socrates is mortal |- Socrates is mortal";
      const ids = env.atomizer.ingestSequence(text, env.system);

      for (const id of ids) {
        assert.notStrictEqual(env.system.posX[id], 0);
        assert.ok(env.system.entropy[id] >= 0);
        assert.ok(env.system.time[id] > 0);
      }
    });

    await TestHarness.disposeEnvironment(env);
  });
}
