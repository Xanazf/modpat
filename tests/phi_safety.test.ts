import assert from "node:assert/strict";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { describe, it } from "./utils/harness";

export async function runPhiSafetyTests() {
  await describe("P2 - φ clamping and numerical safety", async () => {
    await it("1000 atoms at the origin produce no NaN and increment phiClippedCount", async () => {
      const system = new System();
      const N = 1000;

      // All atoms at exactly the same position - pathological density
      for (let i = 0; i < N; i++) {
        const id = system.createLocation(1.0, 1.0);
        system.posX[id] = 0;
        system.posY[id] = 0;
        system.posZ[id] = 0;
        system.posW[id] = 0.5;
        system.update(id);
      }

      const traveler = new Traveler(system);
      traveler.setGPUEnabled(false);

      // Place source and target atoms apart from the pile
      const src = system.createLocation(1.0, 1.0);
      system.posX[src] = -200;
      system.posY[src] = 0;
      system.posZ[src] = 0;
      system.posW[src] = 0.5;
      system.update(src);

      const tgt = system.createLocation(1.0, 1.0);
      system.posX[tgt] = 200;
      system.posY[tgt] = 0;
      system.posZ[tgt] = 0;
      system.posW[tgt] = 0.5;
      system.update(tgt);

      const path = await traveler.traverse(src, tgt, {
        steps: 8,
        maxIterations: 10,
      });

      // No NaN in the returned path IDs
      for (const id of path) {
        assert.ok(!Number.isNaN(id), `NaN in traversal output path`);
      }

      // The dense region must have triggered at least one phi clamp
      assert.ok(
        traveler.phiClippedCount > 0,
        `Expected phiClippedCount > 0 for 1000 co-located atoms, got ${traveler.phiClippedCount}`
      );

      // Confirm PHI_MAX is respected: clipped count stops growing if we set PHI_MAX high
      const savedMax = (DOPAT_CONFIG.PHYSICS as { PHI_MAX: number }).PHI_MAX;
      (DOPAT_CONFIG.PHYSICS as { PHI_MAX: number }).PHI_MAX = Infinity;
      traveler.phiClippedCount = 0;
      const traveler2 = new Traveler(system);
      traveler2.setGPUEnabled(false);
      await traveler2.traverse(src, tgt, { steps: 8, maxIterations: 10 });
      assert.strictEqual(
        traveler2.phiClippedCount,
        0,
        "phiClippedCount should be 0 when PHI_MAX is Infinity"
      );
      (DOPAT_CONFIG.PHYSICS as { PHI_MAX: number }).PHI_MAX = savedMax;
    });
  });
}
