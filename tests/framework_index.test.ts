import assert from "node:assert/strict";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import { buildNerveGraph } from "@core_s/TopologyMapper";
import {
  buildFrameworkIndex,
  resolveActiveAtoms,
  type FrameworkIndex,
} from "@core_s/FrameworkIndex";
import { describe, it } from "./utils/harness";

// --- helpers -----------------------------------------------------------------

function makeSystem(): System {
  return new System();
}

function addAtom(
  sys: System,
  x: number,
  y: number,
  z = 0,
  w = 0.5,
  mass = 1.0,
  scope = 1.0
): number {
  const id = sys.createLocation(mass, scope);
  sys.posX[id] = x;
  sys.posY[id] = y;
  sys.posZ[id] = z;
  sys.posW[id] = w;
  sys.update(id);
  return id;
}

/**
 * Build a system with three tight groups of atoms, well-separated from each
 * other.  The intent:
 *   rSub=5    → each group is one subcluster
 *   rCluster=20 → each group is one cluster
 *   rSuper=40  → all three groups are one supercluster if close together,
 *                 or two/three separate superclusters if placed far apart.
 *
 * We want to verify the three-tier hierarchy for the "well-separated" variant.
 */
function buildThreeGroupSystem(): {
  sys: System;
  groupA: number[];
  groupB: number[];
  groupC: number[];
} {
  const sys = makeSystem();
  // Group A: atoms near (0, 0)
  const groupA = [
    addAtom(sys, 0, 0, 0, 0, 2.0),
    addAtom(sys, 2, 1, 0, 0, 1.5),
    addAtom(sys, 1, 2, 0, 0, 1.0),
  ];
  // Group B: atoms near (200, 0) - separated by >> rSuper
  const groupB = [
    addAtom(sys, 200, 0, 0, 0, 2.0),
    addAtom(sys, 202, 1, 0, 0, 1.5),
    addAtom(sys, 201, 2, 0, 0, 1.0),
  ];
  // Group C: atoms near (0, 200)
  const groupC = [
    addAtom(sys, 0, 200, 0, 0, 2.0),
    addAtom(sys, 2, 201, 0, 0, 1.5),
    addAtom(sys, 1, 202, 0, 0, 1.0),
  ];
  return { sys, groupA, groupB, groupC };
}

export async function runFrameworkIndexTests() {
  await describe("E0 – FrameworkIndex", async () => {
    await it("three-tier hierarchy assigns separated groups to distinct superclusters", async () => {
      const { sys, groupA, groupB, groupC } = buildThreeGroupSystem();
      const graph = buildNerveGraph(sys, { topK: 50 });
      const index = buildFrameworkIndex(sys, graph, {
        rSub: 5,
        rCluster: 20,
        rSuper: 40,
      });

      // Three distinct superclusters (groups are 200 units apart, rSuper=40)
      assert.strictEqual(
        index.superclusters.length,
        3,
        `Expected 3 superclusters, got ${index.superclusters.length}`
      );

      // Three clusters (one per group at rCluster=20)
      assert.strictEqual(
        index.clusters.length,
        3,
        `Expected 3 clusters, got ${index.clusters.length}`
      );

      // Three subclusters (one per group at rSub=5, intra-group spread ≤ sqrt(8) ≈ 2.8)
      assert.strictEqual(
        index.subclusters.length,
        3,
        `Expected 3 subclusters, got ${index.subclusters.length}`
      );

      // Every group atom should appear in exactly one subcluster
      const allSubAtoms = new Set<number>();
      for (const sub of index.subclusters) {
        for (const a of sub.memberAtomIds) allSubAtoms.add(a);
      }
      for (const id of [...groupA, ...groupB, ...groupC]) {
        assert.ok(
          allSubAtoms.has(id),
          `Atom ${id} not found in any subcluster`
        );
      }
    });

    await it("parent/child navigation is consistent", async () => {
      const { sys } = buildThreeGroupSystem();
      const graph = buildNerveGraph(sys, { topK: 50 });
      const index = buildFrameworkIndex(sys, graph, {
        rSub: 5,
        rCluster: 20,
        rSuper: 40,
      });

      // Each cluster's parentSuperclusterId must point to an existing supercluster.
      const superIds = new Set(index.superclusters.map(s => s.id));
      for (const cl of index.clusters) {
        assert.ok(
          superIds.has(cl.parentSuperclusterId),
          `Cluster ${cl.id} has unknown parentSuperclusterId ${cl.parentSuperclusterId}`
        );
      }

      // Each subcluster's parentClusterId must point to an existing cluster.
      const clusterIds = new Set(index.clusters.map(c => c.id));
      for (const sub of index.subclusters) {
        assert.ok(
          clusterIds.has(sub.parentClusterId),
          `Subcluster ${sub.id} has unknown parentClusterId ${sub.parentClusterId}`
        );
      }

      // Each supercluster's childClusterIds must all exist.
      for (const sc of index.superclusters) {
        for (const cid of sc.childClusterIds) {
          assert.ok(
            clusterIds.has(cid),
            `Supercluster ${sc.id} references unknown cluster ${cid}`
          );
        }
      }
    });

    await it("seed atoms are the highest-mass members of each cluster", async () => {
      const { sys } = buildThreeGroupSystem();
      const graph = buildNerveGraph(sys, { topK: 50 });
      const index = buildFrameworkIndex(sys, graph, {
        rSub: 5,
        rCluster: 20,
        rSuper: 40,
        seedsPerCluster: 1,
      });

      for (const cl of index.clusters) {
        assert.strictEqual(cl.seedAtomIds.length, 1);
        const seed = cl.seedAtomIds[0];
        const seedMass = Math.abs(sys.mass[seed]);
        for (const a of cl.memberAtomIds) {
          assert.ok(
            Math.abs(sys.mass[a]) <= seedMass + 1e-9,
            `Atom ${a} (mass ${sys.mass[a]}) is heavier than seed ${seed} (mass ${sys.mass[seed]})`
          );
        }
      }
    });

    await it("resolveActiveAtoms always includes interstitial atoms", async () => {
      const { sys } = buildThreeGroupSystem();
      const graph = buildNerveGraph(sys, { topK: 50 });
      // Large rSub so all atoms form subclusters, leaving the interstitial set empty.
      // Then with small rSub we get interstitials.
      const index = buildFrameworkIndex(sys, graph, {
        rSub: 0.1, // almost no atoms in subclusters → many interstitials
        rCluster: 20,
        rSuper: 40,
      });

      // Pick an arbitrary supercluster
      const sc = index.superclusters[0];
      const active = resolveActiveAtoms(index, new Set([sc.id]));

      // All interstitial atoms must be in the result.
      for (const a of index.interstitial) {
        assert.ok(
          active.has(a),
          `Interstitial atom ${a} missing from active set`
        );
      }
      // All supercluster members must be in the result.
      for (const a of sc.memberAtomIds) {
        assert.ok(
          active.has(a),
          `Supercluster member ${a} missing from active set`
        );
      }
    });

    await it("empty system returns an empty FrameworkIndex", async () => {
      const sys = makeSystem();
      const graph = buildNerveGraph(sys, { topK: 50 });
      const index = buildFrameworkIndex(sys, graph);
      assert.strictEqual(index.superclusters.length, 0);
      assert.strictEqual(index.clusters.length, 0);
      assert.strictEqual(index.subclusters.length, 0);
      assert.strictEqual(index.interstitial.size, 0);
    });

    await it("framework-restricted traversal excludes out-of-scope atoms", async () => {
      // Build two groups: "A" is the active framework, "B" is excluded.
      // Verify that a traversal within group A with activeAtoms set does not
      // visit atoms from group B.
      const sys = makeSystem();
      // Group A near (0,0)
      const a0 = addAtom(sys, 0, 0, 0, 0.5, 2.0);
      const a1 = addAtom(sys, 3, 0, 0, 0.5, 2.0);
      const a2 = addAtom(sys, 0, 3, 0, 0.5, 2.0);
      // Group B far away at (300, 300)
      addAtom(sys, 300, 300, 0, 0.5, 100.0); // very high mass – would normally attract
      addAtom(sys, 302, 300, 0, 0.5, 100.0);
      addAtom(sys, 300, 302, 0, 0.5, 100.0);

      const graph = buildNerveGraph(sys, { topK: 50 });
      const index = buildFrameworkIndex(sys, graph, {
        rSub: 5,
        rCluster: 20,
        rSuper: 40,
      });

      // Find the supercluster containing group A
      const groupAAtoms = new Set([a0, a1, a2]);
      const scA = index.superclusters.find(sc =>
        [...sc.memberAtomIds].some(id => groupAAtoms.has(id))
      );
      assert.ok(scA, "Could not find supercluster for group A");

      const activeAtoms = resolveActiveAtoms(index, new Set([scA.id]));

      // Group B atoms must NOT be in the active set
      for (const id of [300, 302].flatMap(() => [300, 300])) {
        // Just verify no "300+" atom is in the active set by checking memberAtomIds
        for (const a of index.superclusters) {
          if (!groupAAtoms.has([...a.memberAtomIds][0] ?? -1)) {
            // This is the other supercluster - its atoms shouldn't be active
            for (const atom of a.memberAtomIds) {
              if (!activeAtoms.has(atom)) {
                // expected - pass
              }
            }
          }
        }
      }

      // Simpler direct assertion: atoms in active set should only be from scA + interstitial
      const allowedAtoms = new Set([
        ...scA.memberAtomIds,
        ...index.interstitial,
      ]);
      for (const a of activeAtoms) {
        assert.ok(
          allowedAtoms.has(a),
          `Atom ${a} in activeAtoms but not in scA or interstitial`
        );
      }
    });
  });
}
