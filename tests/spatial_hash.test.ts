import assert from "node:assert/strict";
import { BarnesHut4D, type BHAtom } from "@mutate/BarnesHut4D";
import { GridIndex4D } from "@mutate/GridIndex4D";
import { describe, it } from "./utils/harness";

function createMockView(size: number): Root.ManifoldView {
  return {
    posX: new Float64Array(size),
    posY: new Float64Array(size),
    posZ: new Float64Array(size),
    posW: new Float64Array(size),
  } as unknown as Root.ManifoldView;
}

export async function runSpatialHashTests() {
  await describe("GridIndex4D Spatial Hash Tests", async () => {
    await it("Quantization and Hashing - correctly places and retrieves single atom", async () => {
      const grid = new GridIndex4D(10);
      grid.insert(42, 5.0, 15.0, 25.0, 35.0); // cx=0, cy=1, cz=2, cw=3

      const mockView = createMockView(100);
      mockView.posX[42] = 5.0;
      mockView.posY[42] = 15.0;
      mockView.posZ[42] = 25.0;
      mockView.posW[42] = 35.0;

      // Find nearest within radius 20
      const nearId = grid.nearest(5.0, 15.0, 25.0, 35.0, 20.0, mockView);
      assert.strictEqual(nearId, 42);
    });

    await it("Bounds Checks - rejects candidates outside radius", async () => {
      const grid = new GridIndex4D(10);
      grid.insert(1, 0, 0, 0, 0);

      const mockView = createMockView(10);
      mockView.posX[1] = 0;
      mockView.posY[1] = 0;
      mockView.posZ[1] = 0;
      mockView.posW[1] = 0;

      // Query from distance 5, with radius 4.9. Should return -1 since 5 > 4.9.
      const nearId = grid.nearest(5, 0, 0, 0, 4.9, mockView);
      assert.strictEqual(nearId, -1);

      // Query from distance 5, with radius 5.1. Should return 1.
      const nearIdOk = grid.nearest(5, 0, 0, 0, 5.1, mockView);
      assert.strictEqual(nearIdOk, 1);
    });

    await it("ActiveAtoms filtering - ignores excluded atoms", async () => {
      const grid = new GridIndex4D(10);
      grid.insert(1, 1, 1, 1, 1);
      grid.insert(2, 2, 2, 2, 2);

      const mockView = createMockView(10);
      mockView.posX[1] = 1;
      mockView.posY[1] = 1;
      mockView.posZ[1] = 1;
      mockView.posW[1] = 1;
      mockView.posX[2] = 2;
      mockView.posY[2] = 2;
      mockView.posZ[2] = 2;
      mockView.posW[2] = 2;

      // Nearest with activeAtoms only including 2
      const active = new Set<number>([2]);
      const nearId = grid.nearest(0, 0, 0, 0, 10, mockView, active);
      assert.strictEqual(nearId, 2);
    });

    await it("Sorting and ranges - contiguous retrieval of colliding cells", async () => {
      const grid = new GridIndex4D(5);
      // Insert multiple atoms in same cell
      grid.insert(10, 6, 6, 6, 6);
      grid.insert(20, 7, 7, 7, 7);
      grid.insert(30, 8, 8, 8, 8);

      const candidates = grid.candidatesInRadius(6, 6, 6, 6, 1);
      assert.strictEqual(candidates.includes(10), true);
      assert.strictEqual(candidates.includes(20), true);
      assert.strictEqual(candidates.includes(30), true);
      assert.strictEqual(candidates.length, 3);
    });
  });

  await describe("BarnesHut4D Hierarchical Helper Tests", async () => {
    await it("Center of Mass - correctly computes aggregate center of mass", async () => {
      const atoms: BHAtom[] = [
        { id: 1, x: 0.0, y: 0.0, z: 0.0, w: 0.0, mass: 10.0 },
        { id: 2, x: 10.0, y: 10.0, z: 10.0, w: 10.0, mass: 30.0 },
      ];

      const bh = new BarnesHut4D(atoms);

      // We expect the center of mass to be at:
      // (10.0 * 0.0 + 30.0 * 10.0) / 40.0 = 7.5 in each coordinate dimension.
      let computedX = 0,
        computedY = 0,
        computedZ = 0,
        computedW = 0;
      let totalMass = 0;

      bh.computeForce(
        100.0,
        100.0,
        100.0,
        100.0,
        0.9,
        (tx, ty, tz, tw, mass) => {
          computedX = tx;
          computedY = ty;
          computedZ = tz;
          computedW = tw;
          totalMass = mass;
        }
      );

      // Since the query point (100.0) is very far, the Barnes-Hut algorithm
      // should treat the entire system as a single cluster and return its center of mass.
      assert.strictEqual(totalMass, 40.0);
      assert.strictEqual(computedX, 7.5);
      assert.strictEqual(computedY, 7.5);
      assert.strictEqual(computedZ, 7.5);
      assert.strictEqual(computedW, 7.5);
    });

    await it("Theta Criterion - resolves distinct elements when close", async () => {
      const atoms: BHAtom[] = [
        { id: 1, x: 0.0, y: 0.0, z: 0.0, w: 0.0, mass: 10.0 },
        { id: 2, x: 10.0, y: 10.0, z: 10.0, w: 10.0, mass: 30.0 },
      ];

      const bh = new BarnesHut4D(atoms);

      const forces: Array<{ x: number; y: number; mass: number }> = [];

      // Query from close coordinates: query point at (2, 2, 2, 2).
      // Since it is close to the elements compared to the cell size (10.0),
      // it should resolve the atoms individually (i.e. callback should be fired twice).
      bh.computeForce(2.0, 2.0, 2.0, 2.0, 0.5, (tx, ty, _tz, _tw, mass) => {
        forces.push({ x: tx, y: ty, mass });
      });

      assert.strictEqual(forces.length, 2);
      const masses = forces.map(f => f.mass).sort();
      assert.strictEqual(masses[0], 10.0);
      assert.strictEqual(masses[1], 30.0);
    });
  });
}
