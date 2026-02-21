import assert from "node:assert/strict";
import logger from "@src/utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeGPUOffloadTest() {
  await describe("Testing GPU Offloading", async () => {
    const env = await TestHarness.getEnvironment("semantic");

    await it("Resolution consistency: CPU vs GPU", async () => {
      const input = "The sky is blue. Ocean is blue. Blue implies water.";
      env.atomizer.ingestSequence(input, env.system);

      const query = "Ocean is";
      const ids = env.atomizer.ingestSequence(query, env.system);

      env.resolver.setGPUEnabled(false);
      const cpuStartTime = performance.now();
      const cpuResult = await env.resolver.resolveSequence(ids);
      const cpuTime = performance.now() - cpuStartTime;
      const cpuDecoded = env.atomizer.decodeSequence(cpuResult, env.system);

      logger.log(`CPU Resolve (${cpuTime.toFixed(2)}ms): "${cpuDecoded}"`);

      await new Promise(resolve => setTimeout(resolve, 500));
      env.resolver.setGPUEnabled(true);

      const gpuStartTime = performance.now();
      const gpuResult = await env.resolver.resolveSequence(ids);
      const gpuTime = performance.now() - gpuStartTime;
      const gpuDecoded = env.atomizer.decodeSequence(gpuResult, env.system);

      logger.log(`GPU Resolve (${gpuTime.toFixed(2)}ms): "${gpuDecoded}"`);

      assert.strictEqual(
        gpuDecoded,
        cpuDecoded,
        "GPU and CPU resolution must be identical"
      );
    });

    await it("Geodesic Pathfinding: CPU vs GPU", async () => {
      const skyId = env.atomizer.ingestSequence("sky", env.system)[0];
      const waterId = env.atomizer.ingestSequence("water", env.system)[0];

      env.resolver.setGPUEnabled(false);
      const cpuGeoPath = await env.resolver.calculateGeodesic(
        skyId,
        waterId,
        64
      );
      assert.ok(cpuGeoPath.length > 0, "CPU geodesic failed");

      env.resolver.setGPUEnabled(true);
      const gpuGeoPath = await env.resolver.calculateGeodesic(
        skyId,
        waterId,
        64
      );
      assert.ok(gpuGeoPath.length > 0, "GPU geodesic failed");
    });

    await TestHarness.disposeEnvironment(env);
  });
}
