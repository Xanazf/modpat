import assert from "node:assert/strict";
import { computeSessionSheaf, type SessionSheaf } from "@core_s/SessionSheaf";
import type { ClusterId } from "@mutate/FrameworkIndex";
import { describe, it } from "./utils/harness";

// --- helpers -----------------------------------------------------------------

const C = (n: number) => n as ClusterId;

function activations(
  entries: [string, number[]][]
): Map<string, Set<ClusterId>> {
  return new Map(entries.map(([s, cs]) => [s, new Set(cs.map(C))]));
}

export async function runSessionSheafTests() {
  await describe("E2 – Session sheaf / Čech cohomology", async () => {
    // -- trivial cases -----------------------------------------------------

    await it("empty activations → h1Betti = 0", async () => {
      const sheaf = computeSessionSheaf(new Map());
      assert.strictEqual(sheaf.h1Betti, 0);
      assert.strictEqual(sheaf.overlaps.length, 0);
    });

    await it("single session → h1Betti = 0", async () => {
      const sheaf = computeSessionSheaf(activations([["A", [1, 2]]]));
      assert.strictEqual(sheaf.h1Betti, 0);
    });

    await it("two disjoint sessions → h1Betti = 0", async () => {
      // No shared clusters → no overlap edge → one 1-cycle impossible
      const sheaf = computeSessionSheaf(
        activations([
          ["A", [1, 2]],
          ["B", [3, 4]],
        ])
      );
      assert.strictEqual(sheaf.h1Betti, 0);
      assert.strictEqual(sheaf.overlaps.length, 0);
    });

    await it("two overlapping sessions → h1Betti = 0 (acyclic)", async () => {
      const sheaf = computeSessionSheaf(
        activations([
          ["A", [1, 2]],
          ["B", [2, 3]],
        ])
      );
      // One edge, two vertices → β₁ = 1 − 2 + 1 (components) − 0 (no triangles) = 0
      assert.strictEqual(sheaf.h1Betti, 0);
      assert.strictEqual(sheaf.overlaps.length, 1);
    });

    await it("three sessions forming a chain → h1Betti = 0", async () => {
      // A–B–C chain: A∩B≠∅, B∩C≠∅, but A∩C=∅ → no 3-cycle, no triangle
      const sheaf = computeSessionSheaf(
        activations([
          ["A", [1]],
          ["B", [1, 2]],
          ["C", [2]],
        ])
      );
      assert.strictEqual(sheaf.h1Betti, 0);
    });

    // -- contradictory: 3-cycle with no filling triangle --------------------

    await it("three sessions forming a loop without a common triple → h1Betti > 0", async () => {
      // A shares cluster 1 with B, B shares cluster 2 with C, C shares cluster 3 with A.
      // But A∩B∩C = ∅ → no triangle fills the loop → β₁ = 1.
      const sheaf = computeSessionSheaf(
        activations([
          ["A", [1, 3]],
          ["B", [1, 2]],
          ["C", [2, 3]],
        ])
      );
      assert.ok(
        sheaf.h1Betti > 0,
        `Expected h1Betti > 0 for contradictory 3-cycle, got ${sheaf.h1Betti}`
      );
    });

    await it("contradictory 3-cycle: conflictingClusters is non-empty", async () => {
      const sheaf = computeSessionSheaf(
        activations([
          ["A", [1, 3]],
          ["B", [1, 2]],
          ["C", [2, 3]],
        ])
      );
      assert.ok(
        sheaf.conflictingClusters.size > 0,
        "Expected non-empty conflictingClusters"
      );
    });

    // -- consistent triangle fills the cycle -------------------------------

    await it("three sessions sharing a common cluster → triangle fills loop → h1Betti = 0", async () => {
      // A, B, C all share cluster 1 → pairwise overlaps form a triangle.
      // A triangle in the nerve is a 2-simplex that bounds the 3-cycle.
      const sheaf = computeSessionSheaf(
        activations([
          ["A", [1, 2]],
          ["B", [1, 3]],
          ["C", [1, 4]],
        ])
      );
      // 3 edges (A-B, B-C, A-C all overlap on cluster 1), 1 triangle → β₁ = 0
      assert.strictEqual(
        sheaf.h1Betti,
        0,
        `Expected h1Betti = 0 for consistent triple, got ${sheaf.h1Betti}`
      );
    });

    // -- overlap structure -------------------------------------------------

    await it("shared clusters are correctly identified in overlaps", async () => {
      const sheaf = computeSessionSheaf(
        activations([
          ["A", [1, 2, 3]],
          ["B", [2, 3, 4]],
        ])
      );
      assert.strictEqual(sheaf.overlaps.length, 1);
      const ov = sheaf.overlaps[0];
      assert.ok(ov.sharedClusterIds.has(C(2)));
      assert.ok(ov.sharedClusterIds.has(C(3)));
      assert.ok(!ov.sharedClusterIds.has(C(1)));
      assert.ok(!ov.sharedClusterIds.has(C(4)));
    });

    await it("restrictionDifference has correct length", async () => {
      const sheaf = computeSessionSheaf(
        activations([
          ["A", [1, 2]],
          ["B", [2, 3]],
        ])
      );
      const ov = sheaf.overlaps[0];
      assert.strictEqual(
        ov.restrictionDifference.length,
        ov.sharedClusterIds.size
      );
    });

    await it("restrictionDifference calculates correct values using session cluster phis", async () => {
      const active = activations([
        ["A", [1, 2]],
        ["B", [2, 3]],
      ]);
      const sessionPhis = new Map<string, Map<ClusterId, number>>([
        ["A", new Map([[C(2), 5.5]])],
        ["B", new Map([[C(2), 2.3]])],
      ]);
      const sheaf = computeSessionSheaf(active, sessionPhis);
      assert.strictEqual(sheaf.overlaps.length, 1);
      const ov = sheaf.overlaps[0];
      assert.strictEqual(ov.restrictionDifference.length, 1);
      assert.ok(Math.abs(ov.restrictionDifference[0] - 3.2) < 1e-9);
    });
  });
}
