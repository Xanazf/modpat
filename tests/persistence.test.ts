import { DatabaseContext } from "@_lib/persistence/DatabaseContext";
import * as assert from "node:assert";
import { DOPAT_CONFIG } from "@config";
import { SCHEMA_VERSION, SystemPersistence } from "@core_s/Persistence";
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
      assert.strictEqual(
        env.system.length,
        1,
        "reset() must reserve the NULL slot (id=0)"
      );

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

    await it("hydrate: schema version mismatch throws", async () => {
      const ctx2 = new DatabaseContext(":memory:");
      const conn2 = await ctx2.connect();
      const pers2 = new SystemPersistence(conn2);

      // Snapshot a minimal valid state, then corrupt the version.
      const id = env.system.createLocation(1.0, 1.0);
      await env.system.snapshot(pers2);
      await conn2.run(
        `UPDATE system_metadata SET value = '99' WHERE key = 'schema_version'`
      );

      const freshEnv = await TestHarness.getEnvironment("base");
      await assert.rejects(
        () => freshEnv.system.hydrate(pers2),
        (err: Error) => /schema version mismatch/i.test(err.message)
      );
      env.system.freeLocation(id);
      await TestHarness.disposeEnvironment(freshEnv);
      await ctx2.close();
    });

    await it("hydrate: out-of-bounds id throws", async () => {
      const ctx3 = new DatabaseContext(":memory:");
      const conn3 = await ctx3.connect();
      const pers3 = new SystemPersistence(conn3);

      // Manually populate a snapshot with an OOB id.
      const oobId = DOPAT_CONFIG.MAX_PRECEPTS; // exactly at the boundary
      await conn3.run(`
        INSERT INTO system_metadata (key, value) VALUES
          ('length', '${oobId + 1}'),
          ('schema_version', '${SCHEMA_VERSION}')
      `);
      await conn3.run(`
        INSERT INTO precepts (id, mass, scope, depth, time, posX, posY, posZ, posW,
          density, entropyRate, potency, intensity, decayRate, checksum,
          part_layer, complex_layer, operator_class)
        VALUES (${oobId}, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01, 0, 0, 0, 0)
      `);

      const freshEnv2 = await TestHarness.getEnvironment("base");
      await assert.rejects(
        () => freshEnv2.system.hydrate(pers3),
        (err: Error) => /out of bounds/i.test(err.message)
      );
      await TestHarness.disposeEnvironment(freshEnv2);
      await ctx3.close();
    });

    await dbContext.close();
    await TestHarness.disposeEnvironment(env);
  });
}
