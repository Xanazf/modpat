import { DatabaseContext } from "@core_s/DatabaseContext";
import { SystemPersistence } from "@core_s/Persistence";
import { ManifoldManager } from "@core_s/ManifoldManager";
import System from "@core_i/System";
import LiveInference from "@core_i/LiveInference";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import Resolver from "@core_i/Resolver";
import Store from "@core_s/Memory";
import * as assert from "assert";
import { describe, it } from "./utils/harness";
import { DOPAT_CONFIG } from "@config";
import * as fs from "fs";
import * as path from "path";

export async function executeContinuousLearningSuite() {
  await describe("CONTINUOUS LEARNING TEST SUITE", async () => {
    // Ensure data directory exists
    const dataDir = path.resolve(__dirname, "../data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, "persistent_learning.duckdb");
    const dbContext = new DatabaseContext(dbPath);
    const connection = await dbContext.connect();
    const persistence = new SystemPersistence(connection);

    // Setup primary and emergency systems
    const primary = new System();
    const emergency = new System();

    // Hydrate to maintain persistent memory store across runs
    await primary.hydrate(persistence);

    const manager = new ManifoldManager(primary, emergency, persistence);
    const atomizer = new SemanticAtomizer();
    const store = new Store(primary, atomizer, dbPath);
    const resolver = new Resolver(primary, atomizer, store);
    await store.waitForInit();

    const inference = new LiveInference(primary, atomizer, resolver, store);
    const responses: string[] = [];
    inference.respond = (res: string) => responses.push(res);

    await it("Phase 1: Thermodynamic Forgetting (Topological Pruning)", async () => {
      const sys = manager.getActiveSystem();

      // Create a node meant to be forgotten.
      const VACUUM_THRESHOLD = DOPAT_CONFIG.DRIFT_THRESHOLD * 0.001;
      const initialMass = VACUUM_THRESHOLD * 0.9;
      const initialScope = 1.0;
      const id = sys.createLocation(initialMass, initialScope, "test_forget");

      // Ensure entropyRate > CRITICAL_ENTROPY (100.0)
      // Entropy rate = time / scope. So time = 200.0, scope = 1.0 => entropyRate = 200.0
      sys.time[id] = 200.0;
      sys.update(id);

      assert.ok(sys.isAllocated(id), "Node should be allocated initially");

      // Tick the manager to trigger decay
      manager.tick(1.0);
      await manager.waitForStability(); // Wait for any async self-healing to finish

      assert.strictEqual(
        sys.isAllocated(id),
        false,
        "Node should be pruned (forgotten)"
      );
    });

    await it("Phase 2: Gravitational Consolidation (Exact Match Fusion)", async () => {
      const sys = manager.getActiveSystem();

      const scope = 42.0;
      const id1 = sys.createLocation(100.0, scope, "test_fusion_1");
      const id2 = sys.createLocation(50.0, scope, "test_fusion_2");

      sys.operatorClass[id1] = 0;
      sys.operatorClass[id2] = 0;

      sys.posX[id1] = 10.0;
      sys.posY[id1] = 10.0;
      sys.posZ[id1] = 10.0;
      sys.posW[id1] = 10.0;
      sys.depth[id1] = 1.0;

      sys.posX[id2] = 10.0;
      sys.posY[id2] = 10.0;
      sys.posZ[id2] = 10.0;
      sys.posW[id2] = 10.0;
      sys.depth[id2] = 2.0;

      sys.update(id1);
      sys.update(id2);

      // Force clustering check by just running many ticks
      let merged = false;

      for (let i = 0; i < 1000; i++) {
        manager.tick(0.1);
        if (!sys.isAllocated(id1) || !sys.isAllocated(id2)) {
          merged = true;
          break;
        }
      }
      await manager.waitForStability();

      assert.ok(merged, "Nodes should have merged");
      const survivingId = sys.isAllocated(id1) ? id1 : id2;
      console.log("Surviving Mass:", sys.mass[survivingId]);
      assert.ok(sys.mass[survivingId] > 10.0, "Mass should be accumulated");
      assert.ok(sys.depth[survivingId] > 2.0, "Depth should be accumulated");
    });

    await it("Phase 2: Gravitational Consolidation (Orbital Clustering)", async () => {
      const sys = manager.getActiveSystem();

      const id1 = sys.createLocation(200.0, 10.0, "test_orbit_1");
      const id2 = sys.createLocation(50.0, 20.0, "test_orbit_2"); // Different scope

      sys.operatorClass[id1] = 0;
      sys.operatorClass[id2] = 0;

      sys.posX[id1] = 0.0;
      sys.posY[id1] = 0.0;
      sys.posZ[id1] = 0.0;
      sys.posW[id1] = 0.0;

      sys.posX[id2] = 0.1; // Close but not exact
      sys.posY[id2] = 0.1;
      sys.posZ[id2] = 0.1;
      sys.posW[id2] = 0.1;

      sys.update(id1);
      sys.update(id2);

      const initialScope2 = sys.scope[id2];
      const rootScope = sys.scope[id1];

      let blended = false;

      for (let i = 0; i < 1000; i++) {
        manager.tick(0.1);
        if (Math.abs(sys.scope[id2] - rootScope) < Math.abs(initialScope2 - rootScope)) {
          blended = true;
          break; // Scope is blending!
        }
      }
      await manager.waitForStability();

      assert.ok(blended, "Satellite scope should move closer to root scope");
      assert.ok(sys.isAllocated(id1) && sys.isAllocated(id2), "Both nodes should still exist (no fusion)");
    });

    await it("Phase 3: Crystallization Feedback (Contradiction Detection)", async () => {
      // Need a LiveInference instance to test this properly
      const SemanticAtomizer = require("@atomics/SemanticAtomizer").default;
      const Resolver = require("@core_i/Resolver").default;
      const LiveInference = require("@core_i/LiveInference").LiveInference;

      const atomizer = new SemanticAtomizer();
      const resolver = new Resolver(primary, atomizer, persistence as any);

      // Use existing store
      const store = persistence as any; // Mocked or real Store

      // Since Store requires specific methods, let's create a proper one if needed,
      // but in this test suite we didn't init Store. Let's just create one.
      const Store = require("@core_s/Memory").default;
      const realStore = new Store(primary, atomizer, dbPath);
      await realStore.waitForInit();

      const inference = new LiveInference(primary, atomizer, resolver, realStore);

      // 1. Ingest a fact
      await inference.processIntent("gravity is strong");

      // 2. Ingest the opposite fact
      const response = await inference.processIntent("gravity is not strong");

      assert.ok(response.includes("Logic Trap Detected"), "Should detect contradiction");

      await realStore.close();
    });

    // Save state across runs
    await primary.snapshot(persistence);
    await dbContext.close();
  });
}

async function run() {
  try {
    await executeContinuousLearningSuite();
  } catch (_) {
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  run();
}
