/**
 * F4 – Long-session φ persistence test.
 *
 * Verifies that density (φ) values built up during one session are saved to
 * the persistent Store and correctly restored as a phi-seed on the next boot,
 * so heavily-visited concepts carry elevated density into future sessions.
 */

import assert from "node:assert/strict";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Store from "@core_s/Memory";
import { describe, it } from "./utils/harness";

export async function runPhiSessionTest() {
  await describe("F4: session φ persistence", async () => {
    await it("saves and loads density keyed by scope", async () => {
      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();

      const ids = atomizer.ingestSequence(
        "gravity pulls objects downward",
        system
      );
      assert.ok(ids.length > 0, "atoms created during ingest");

      const targetScope = system.scope[ids[0]];
      const artificialPhi = 0.75;
      system.density[ids[0]] = artificialPhi;

      await store.saveSessionPhi(system);

      const loaded = await store.loadSessionPhi();
      assert.ok(loaded.size > 0, "session_phi has entries after save");

      const saved = loaded.get(targetScope);
      assert.ok(saved !== undefined, "target scope is present in loaded map");

      const expected = artificialPhi * DOPAT_CONFIG.PHYSICS.PHI_SESSION_BLEND;
      assert.ok(
        Math.abs((saved ?? 0) - expected) < 1e-9,
        `saved phi=${saved?.toFixed(6)} ≈ expected ${expected.toFixed(6)}`
      );

      await store.close();
    });

    await it("phi seed boosts atom density above fresh baseline at createLocation", async () => {
      const atomizer = new LogicAtomizer();
      await atomizer.init();

      // Measure fresh density for the first atom of this phrase
      const fresh = new System();
      const freshStore = new Store(fresh, atomizer, ":memory:");
      await freshStore.waitForInit();
      const freshIds = atomizer.ingestSequence(
        "gravity pulls objects downward",
        fresh
      );
      const targetScope = fresh.scope[freshIds[0]];
      const freshDensity = fresh.density[freshIds[0]];
      await freshStore.close();

      // Now create a seeded session
      const seeded = new System();
      const seededPhi = freshDensity + 0.5; // noticeably above fresh
      seeded.setPhiSeedMap(new Map([[targetScope, seededPhi]]));

      const seededStore = new Store(seeded, atomizer, ":memory:");
      await seededStore.waitForInit();
      const seededIds = atomizer.ingestSequence(
        "gravity pulls objects downward",
        seeded
      );

      let boosted: number | null = null;
      for (const id of seededIds) {
        if (seeded.scope[id] === targetScope) {
          boosted = seeded.density[id];
          break;
        }
      }
      assert.ok(boosted !== null, "seeded atom found");
      assert.ok(
        (boosted ?? 0) >= seededPhi,
        `boosted density ${boosted?.toFixed(6)} >= phi seed ${seededPhi.toFixed(6)}`
      );
      assert.ok(
        (boosted ?? 0) > freshDensity,
        `boosted density ${boosted?.toFixed(6)} > fresh baseline ${freshDensity.toFixed(6)}`
      );

      await seededStore.close();
    });

    await it("empty phi seed map is a no-op", async () => {
      const system = new System();
      system.setPhiSeedMap(new Map());
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const ids = atomizer.ingestSequence("sky is blue", system);
      assert.ok(ids.length > 0, "atoms created normally");
      for (const id of ids) {
        assert.ok(
          Number.isFinite(system.density[id]) && system.density[id] >= 0,
          `density[${id}] finite and non-negative`
        );
      }
    });

    await it("loadSessionPhi returns empty map when table is empty", async () => {
      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();
      const map = await store.loadSessionPhi();
      assert.strictEqual(map.size, 0, "empty map on fresh store");
      await store.close();
    });
  });
}
