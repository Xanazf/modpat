import { DatabaseContext } from "@src/core/structural/DatabaseContext";
import { SystemPersistence } from "@src/core/structural/Persistence";
import logger from "@src/utils/SpectralLogger";
import * as assert from "assert";
import { describe, it, TestHarness } from "./utils/harness";

export async function executePersistenceSuite() {
  await describe("DOD PERSISTENCE TEST SUITE (DUCKDB)", async () => {
    const env = await TestHarness.getEnvironment("base");
    const dbContext = new DatabaseContext(":memory:");
    const connection = await dbContext.connect();
    const persistence = new SystemPersistence(connection);

    await it("Setting up initial manifold state and snapshots", async () => {
      const id1 = env.system.createLocation(100.0, 1.0);
      const id2 = env.system.createLocation(50.0, 2.0);

      env.system.posX[id1] = 10.0;
      env.system.posY[id1] = 20.0;
      env.system.posX[id2] = 30.0;
      env.system.posY[id2] = 40.0;

      env.system.update(id1);
      env.system.update(id2);

      const originalLength = env.system.length;
      const originalMass1 = env.system.mass[id1];
      const originalChecksum1 = env.system.checksum[id1];

      await env.system.snapshot(persistence);

      env.system.reset();
      assert.strictEqual(env.system.length, 0);

      await env.system.hydrate(persistence);

      assert.strictEqual(env.system.length, originalLength, "Length mismatch");
      assert.strictEqual(env.system.mass[id1], originalMass1, "Mass mismatch");
      assert.strictEqual(
        env.system.checksum[id1],
        originalChecksum1,
        "Checksum mismatch"
      );
      assert.strictEqual(env.system.posX[id1], 10.0, "PosX mismatch");

      const corrupted = env.system.checkIntegrity();
      assert.strictEqual(corrupted.length, 0, "Integrity check failed");
    });

    await it("Testing analytical query", async () => {
      const highMassIds = await persistence.queryHighMassInRadius(
        80,
        10,
        20,
        5
      );
      assert.strictEqual(highMassIds.length, 1);
    });

    await dbContext.close();
    await TestHarness.disposeEnvironment(env);
  });
}
