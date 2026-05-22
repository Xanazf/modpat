import assert from "node:assert/strict";
import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { buildNerveGraph } from "@core_s/TopologyMapper";
import { buildFrameworkIndex } from "@core_s/FrameworkIndex";
import { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";
import { SystemPersistence } from "@core_s/Persistence";
import { DatabaseContext } from "@core_s/DatabaseContext";
import { describe, it } from "./utils/harness";
import LogicAtomizer from "@atomics/LogicAtomizer";

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

export async function runTravelerCorrectionsTests() {
  await describe("Traveler Rewrite Corrections", async () => {
    await it("individual atom settling moves atoms away from the pole", async () => {
      const sys = new System();
      const traveler = new Traveler(sys);

      // Ingest atoms: simulate Language._poleSettle where coordinates are overridden to pole + jitter
      const id1 = addAtom(sys, 0.01, 0.01, 0.0, 0.05, 5.0, 10);
      const id2 = addAtom(sys, -0.01, -0.01, 0.0, 0.05, 5.0, 10);

      // Define some existing clusters far away to act as target coordinates (drift targets)
      const target1: [number, number, number, number] = [15.0, 15.0, 0.0, 0.0];
      const target2: [number, number, number, number] = [20.0, -20.0, 0.0, 0.0];

      // Add attraction center atoms at those target coordinates so getMetricForce pulls toward them
      addAtom(sys, 15.0, 15.0, 0.0, 0.0, 100.0, 11);
      addAtom(sys, 20.0, -20.0, 0.0, 0.0, 100.0, 12);

      const driftTargets = new Map<
        number,
        readonly [number, number, number, number]
      >();
      driftTargets.set(id1, target1);
      driftTargets.set(id2, target2);

      // Settle the atoms
      traveler["_settleAtoms"](new Uint32Array([id1, id2]), driftTargets);

      // Verify they have moved significantly from the pole (0,0,0,0) toward target coords
      const dist1 = Math.sqrt(
        sys.posX[id1] ** 2 +
          sys.posY[id1] ** 2 +
          sys.posZ[id1] ** 2 +
          sys.posW[id1] ** 2
      );
      const dist2 = Math.sqrt(
        sys.posX[id2] ** 2 +
          sys.posY[id2] ** 2 +
          sys.posZ[id2] ** 2 +
          sys.posW[id2] ** 2
      );

      assert.ok(
        dist1 > 0.2,
        `Atom 1 did not settle away from pole: dist=${dist1}`
      );
      assert.ok(
        dist2 > 0.2,
        `Atom 2 did not settle away from pole: dist=${dist2}`
      );
    });

    await it("activeFrameworks is populated live from path history during traversal", async () => {
      const sys = new System();
      const traveler = new Traveler(sys);

      // Wire a lifecycle context
      const emergency = new System();
      const dbCtx = new DatabaseContext(":memory:");
      const conn = await dbCtx.connect();
      const persistence = new SystemPersistence(conn);
      const lifecycle = new ManifoldLifecycle(sys, emergency, persistence);
      traveler.setLifecycle(lifecycle);

      // Add two separated groups to form distinct clusters
      // Group A near (0,0)
      const a1 = addAtom(sys, 0, 0, 0, 0.5, 20.0, 10);
      const a2 = addAtom(sys, 2, 1, 0, 0.5, 10.0, 10);
      // Group B near (100, 100)
      const b1 = addAtom(sys, 100, 100, 0, 0.5, 20.0, 20);
      const b2 = addAtom(sys, 102, 101, 0, 0.5, 10.0, 20);

      // Build framework index in lifecycle
      const graph = buildNerveGraph(sys, { topK: 50 });
      lifecycle["_nerveGraph"] = graph;
      lifecycle["_frameworkIndex"] = buildFrameworkIndex(sys, graph, {
        rSub: 5,
        rCluster: 20,
        rSuper: 40,
      });

      // Initially activeFrameworks is empty
      assert.strictEqual(traveler.activeFrameworks.size, 0);

      // Execute traversal along a path containing Group A atoms
      const path = new Uint32Array([a1, a2]);
      traveler["_updateTravelerState"](a2, path);

      // activeFrameworks must now contain the supercluster/cluster/subcluster IDs containing Group A atoms
      assert.ok(traveler.activeFrameworks.size > 0);

      // Verify that Group B framework IDs are NOT present in activeFrameworks
      const index = lifecycle.getFrameworkIndex()!;
      const groupBSuperId = index.superclusters.find(sc =>
        sc.memberAtomIds.has(b1)
      )?.id;
      if (groupBSuperId !== undefined) {
        assert.ok(!traveler.activeFrameworks.has(groupBSuperId));
      }

      await dbCtx.close();
    });

    await it("framework-restricted traversal restricts candidate filtering to active framework set", async () => {
      const sys = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const traveler = new Traveler(sys, atomizer);

      // Wire a lifecycle context
      const emergency = new System();
      const dbCtx = new DatabaseContext(":memory:");
      const conn = await dbCtx.connect();
      const persistence = new SystemPersistence(conn);
      const lifecycle = new ManifoldLifecycle(sys, emergency, persistence);
      traveler.setLifecycle(lifecycle);

      // Add two separated groups to form distinct clusters
      // Group A near (0,0) - active
      const a1 = addAtom(sys, 0, 0, 0, 0.5, 20.0, 10);
      const a2 = addAtom(sys, 5, 5, 0, 0.5, 20.0, 10);
      // Group B near (50, 50) - inactive (normally a strong attractor)
      const b1 = addAtom(sys, 50, 50, 0, 0.5, 1000.0, 20);

      // Build framework index in lifecycle
      const graph = buildNerveGraph(sys, { topK: 50 });
      lifecycle["_nerveGraph"] = graph;
      lifecycle["_frameworkIndex"] = buildFrameworkIndex(sys, graph, {
        rSub: 10,
        rCluster: 20,
        rSuper: 40,
      });

      const index = lifecycle.getFrameworkIndex()!;
      const scA = index.superclusters.find(sc => sc.memberAtomIds.has(a1))!;

      // Manually set activeFrameworks to ONLY Group A's supercluster
      traveler.activeFrameworks.add(scA.id);

      // Run observeSettlingGradient for atoms in Group A
      const result = await traveler.observeSettlingGradient(
        new Uint32Array([a1])
      );

      // Verify that Group B's massive atom b1 was NOT visited or returned, even though it's much heavier
      const resultArr = Array.from(result);
      assert.ok(
        !resultArr.includes(b1),
        "Should not traverse to or return inactive Group B atoms"
      );

      await dbCtx.close();
    });
  });
}
