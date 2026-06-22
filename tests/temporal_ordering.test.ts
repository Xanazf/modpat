import assert from "node:assert/strict";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { describe, it } from "./utils/harness";

/**
 * Regression suite for A1 Flag 2: temporal coherence via the smooth dW
 * suppression factor.  Routes from a mid-freshness probe should prefer
 * passing through fresh atoms over stale atoms when both are geometrically
 * equidistant from the path.
 */
export async function runTemporalOrderingTests() {
  await describe("A1 - temporal ordering (dW suppression)", async () => {
    await it("path prefers fresh bridge atom over stale bridge atom", async () => {
      const system = new System();

      // Source and target on the X axis
      const src = system.createLocation(2.0, 1.0);
      system.posX[src] = -100;
      system.posY[src] = 0;
      system.posZ[src] = 0;
      system.posW[src] = 0.5;
      system.update(src);

      const tgt = system.createLocation(2.0, 1.0);
      system.posX[tgt] = 100;
      system.posY[tgt] = 0;
      system.posZ[tgt] = 0;
      system.posW[tgt] = 0.5;
      system.update(tgt);

      // Fresh bridge - same posW as probe, offset in Y
      const freshBridge = system.createLocation(5.0, 1.0);
      system.posX[freshBridge] = 0;
      system.posY[freshBridge] = 30;
      system.posZ[freshBridge] = 0;
      system.posW[freshBridge] = 0.9;
      system.update(freshBridge);

      // Stale bridge - significantly older, symmetric offset in -Y
      const staleBridge = system.createLocation(5.0, 1.0);
      system.posX[staleBridge] = 0;
      system.posY[staleBridge] = -30;
      system.posZ[staleBridge] = 0;
      system.posW[staleBridge] = 0.05;
      system.update(staleBridge);

      const traveler = new Traveler(system);
      traveler.setGPUEnabled(false);

      const path = await traveler.traverse(src, tgt, {
        steps: 16,
        maxIterations: 80,
      });

      // Collect all intermediate atom positions from the path
      let freshCount = 0,
        staleCount = 0;
      for (const id of path) {
        const posW = system.posW[id];
        if (posW >= 0.7) freshCount++;
        if (posW <= 0.1) staleCount++;
      }

      assert.ok(
        freshCount >= staleCount,
        `Expected path to favour fresh atoms (freshCount=${freshCount}) ` +
          `over stale atoms (staleCount=${staleCount})`
      );
    });

    await it("disabling PHI_TEMPORAL_DECAY removes the fresh-over-stale preference", async () => {
      // With decay=0, fresh and stale bridges should be equally attractive.
      // The path should no longer strongly prefer the fresh bridge.
      const system = new System();

      const src = system.createLocation(2.0, 1.0);
      system.posX[src] = -100;
      system.posY[src] = 0;
      system.posZ[src] = 0;
      system.posW[src] = 0.5;
      system.update(src);

      const tgt = system.createLocation(2.0, 1.0);
      system.posX[tgt] = 100;
      system.posY[tgt] = 0;
      system.posZ[tgt] = 0;
      system.posW[tgt] = 0.5;
      system.update(tgt);

      const freshBridge = system.createLocation(5.0, 1.0);
      system.posX[freshBridge] = 0;
      system.posY[freshBridge] = 30;
      system.posZ[freshBridge] = 0;
      system.posW[freshBridge] = 0.9;
      system.update(freshBridge);

      const staleBridge = system.createLocation(5.0, 1.0);
      system.posX[staleBridge] = 0;
      system.posY[staleBridge] = -30;
      system.posZ[staleBridge] = 0;
      system.posW[staleBridge] = 0.05;
      system.update(staleBridge);

      const saved = (DOPAT_CONFIG.PHYSICS as { PHI_TEMPORAL_DECAY: number })
        .PHI_TEMPORAL_DECAY;

      // With normal decay: fresh dominates
      (
        DOPAT_CONFIG.PHYSICS as { PHI_TEMPORAL_DECAY: number }
      ).PHI_TEMPORAL_DECAY = 3.0;
      const t1 = new Traveler(system);
      t1.setGPUEnabled(false);
      const pathNormal = await t1.traverse(src, tgt, {
        steps: 16,
        maxIterations: 80,
      });
      let freshN = 0,
        staleN = 0;
      for (const id of pathNormal) {
        if (system.posW[id] >= 0.7) freshN++;
        if (system.posW[id] <= 0.1) staleN++;
      }

      // With decay=0: no temporal suppression - expect stale to regain influence
      (
        DOPAT_CONFIG.PHYSICS as { PHI_TEMPORAL_DECAY: number }
      ).PHI_TEMPORAL_DECAY = 0;
      const t2 = new Traveler(system);
      t2.setGPUEnabled(false);
      const pathFlat = await t2.traverse(src, tgt, {
        steps: 16,
        maxIterations: 80,
      });
      let freshF = 0,
        staleF = 0;
      for (const id of pathFlat) {
        if (system.posW[id] >= 0.7) freshF++;
        if (system.posW[id] <= 0.1) staleF++;
      }

      (
        DOPAT_CONFIG.PHYSICS as { PHI_TEMPORAL_DECAY: number }
      ).PHI_TEMPORAL_DECAY = saved;

      // The fresh advantage (freshCount - staleCount) must shrink when decay is removed.
      const advantageNormal = freshN - staleN;
      const advantageFlat = freshF - staleF;
      assert.ok(
        advantageFlat <= advantageNormal,
        `Temporal suppression removal should reduce fresh advantage: ` +
          `normal=${advantageNormal}, flat=${advantageFlat}`
      );
    });
  });
}
