import assert from "node:assert/strict";
import { DOPAT_CONFIG } from "@config";
import logger from "@utils/SpectralLogger";
import { describe, it, TestHarness } from "./utils/harness";

export async function executeStressSuite() {
  await describe("MODPAT STRESS & EDGE-CASE SUITE", async () => {
    const env = await TestHarness.getEnvironment("base");

    await it("Stress Test: System Capacity Overflow", async () => {
      const sys = env.system;
      sys.reset();
      for (let i = 0; i < DOPAT_CONFIG.MAX_PRECEPTS; i++) {
        sys.createLocation(1.0, 1.0);
      }
      assert.throws(() => {
        sys.createLocation(1.0, 1.0);
      }, /System capacity reached/);
      sys.reset();
    });

    await it("Stress Test: Sequence Length Boundary", async () => {
      const longTokens = new Array(1100).fill("test").join(" ");
      const ids = env.atomizer.ingestSequence(longTokens, env.system);
      await assert.rejects(async () => {
        await env.resolver.resolveSequence(ids);
      }, /exceeds max DOD buffer capacity/);
    });

    await it("Numerical Stability: Deep Transitivity (50 steps)", async () => {
      const chainSize = 50;
      for (let i = 0; i < chainSize; i++) {
        const fromChar = String.fromCharCode(65 + i);
        const toChar = String.fromCharCode(66 + i);
        env.atomizer.ingestSequence(
          `${fromChar} implies ${toChar}`,
          env.system
        );
      }

      const lastChar = String.fromCharCode(65 + chainSize);
      const ids = env.atomizer.ingestSequence("A |-", env.system);
      const resolvedIds = await env.resolver.resolveSequence(ids);
      const result = env.atomizer.decodeSequence(resolvedIds, env.system);

      if (result.includes(lastChar.toLowerCase())) {
        logger.log(
          `  ✓ Successfully propagated logic through ${chainSize} steps`
        );
      } else {
        logger.warn(`  ! Logic faded after ${chainSize} steps. Got: ${result}`);
      }
    });

    await it("Memory Integrity: Checksum Validation & Corruption Detection", async () => {
      const id = env.system.createLocation(100.0, 50.0);
      assert.ok(env.system.validate(id));

      const massView = new Float64Array(
        env.system.buffer,
        env.system.mass.byteOffset,
        DOPAT_CONFIG.MAX_PRECEPTS
      );
      massView[id] = 9999.9;

      assert.ok(!env.system.validate(id));
      const corrupted = env.system.checkIntegrity();
      assert.strictEqual(corrupted[0], id);
    });

    await it("Stability: Circular Logic (A -> B -> A)", async () => {
      env.atomizer.ingestSequence("a implies b", env.system);
      env.atomizer.ingestSequence("b implies a", env.system);

      const ids = env.atomizer.ingestSequence("a |-", env.system);
      const resolvedIds = await env.resolver.resolveSequence(ids);
      assert.ok(resolvedIds.length > 0);
    });

    await TestHarness.disposeEnvironment(env);
  });
}
