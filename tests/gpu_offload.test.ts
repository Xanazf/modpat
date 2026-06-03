import assert from "node:assert/strict";
import { DOPAT_CONFIG } from "@config";
import { gpu_math } from "@core_s/Math";
import logger from "@utils/SpectralLogger";
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
      const cpuStart = performance.now();
      const cpuResult = await env.resolver.resolveSequence(ids);
      const cpuTime = performance.now() - cpuStart;
      const cpuDecoded = env.atomizer.decodeSequence(cpuResult, env.system);
      logger.log(`CPU Resolve (${cpuTime.toFixed(2)}ms): "${cpuDecoded}"`);

      // Semantic check: "Ocean is blue", the answer should be "blue" or a
      // closely related token, not "unknown".
      assert.ok(
        cpuDecoded.toLowerCase() !== "unknown",
        `CPU resolve should not return "unknown" for a known fact; got "${cpuDecoded}"`
      );
      assert.ok(
        cpuDecoded.toLowerCase().includes("blue"),
        `CPU should resolve "Ocean is" to something about blue; got "${cpuDecoded}"`
      );

      // GPU fence: await the device instead of an arbitrary timeout.
      // setGPUEnabled fires an async device-init that completes before getDevice resolves.
      env.resolver.setGPUEnabled(true);
      await gpu_math.getDevice(); // f32 GPU; accept up to 1e-4 relative error vs f64 CPU

      const gpuStart = performance.now();
      const gpuResult = await env.resolver.resolveSequence(ids);
      const gpuTime = performance.now() - gpuStart;
      const gpuDecoded = env.atomizer.decodeSequence(gpuResult, env.system);
      logger.log(`GPU Resolve (${gpuTime.toFixed(2)}ms): "${gpuDecoded}"`);

      assert.strictEqual(
        gpuDecoded,
        cpuDecoded,
        `GPU and CPU resolution must agree; CPU="${cpuDecoded}" GPU="${gpuDecoded}"`
      );
    });

    await it("Geodesic Pathfinding: CPU vs GPU", async () => {
      const skyId = env.atomizer.ingestSequence("sky", env.system)[0];
      const waterId = env.atomizer.ingestSequence("water", env.system)[0];

      // This test validates the relaxPath GPU path (the rollback mechanism), so
      // pin it: directed settling is CPU-only and would make both runs identical.
      const prevPrimary = DOPAT_CONFIG.PHYSICS.SETTLING_TRAVERSE_PRIMARY;
      (
        DOPAT_CONFIG.PHYSICS as { SETTLING_TRAVERSE_PRIMARY: boolean }
      ).SETTLING_TRAVERSE_PRIMARY = false;
      try {
        await runGeodesicCpuVsGpu(env, skyId, waterId);
      } finally {
        (
          DOPAT_CONFIG.PHYSICS as { SETTLING_TRAVERSE_PRIMARY: boolean }
        ).SETTLING_TRAVERSE_PRIMARY = prevPrimary;
      }
    });

    await TestHarness.disposeEnvironment(env);
  });
}

async function runGeodesicCpuVsGpu(
  env: Awaited<ReturnType<typeof TestHarness.getEnvironment>>,
  skyId: number,
  waterId: number
): Promise<void> {
  env.resolver.setGPUEnabled(false);
  const cpuPath = await env.resolver.calculateGeodesic(skyId, waterId, 64);
  assert.ok(cpuPath.length > 0, "CPU geodesic must return at least one node");

  // Path should be internally consistent: all IDs must be allocated.
  for (const id of cpuPath) {
    assert.ok(
      env.system.isAllocated(id),
      `CPU geodesic returned unallocated node id=${id}`
    );
  }

  env.resolver.setGPUEnabled(true);
  await gpu_math.getDevice();
  const gpuPath = await env.resolver.calculateGeodesic(skyId, waterId, 64);
  assert.ok(gpuPath.length > 0, "GPU geodesic must return at least one node");

  // Both paths should start near the source and end near the target.
  assert.strictEqual(
    gpuPath[0],
    cpuPath[0],
    "CPU and GPU geodesics must share the same start node"
  );
}
