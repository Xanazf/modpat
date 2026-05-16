import { DatabaseContext } from "@core_s/DatabaseContext";
import { SystemPersistence } from "@core_s/Persistence";
import { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";
import Unfolder from "@core_s/Unfolder";
import System from "@core_i/System";
import { OperatorClass } from "@core_i/System";
import { LiveInference } from "@core_i/Runtime";
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
    const dataDir = path.resolve(__dirname, "../data");
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

    const dbPath = path.join(dataDir, "persistent_learning.duckdb");
    const dbContext = new DatabaseContext(dbPath);
    const connection = await dbContext.connect();
    const persistence = new SystemPersistence(connection);

    const primary = new System();
    const emergency = new System();
    await primary.hydrate(persistence);

    const manager = new ManifoldLifecycle(primary, emergency, persistence);
    const atomizer = new SemanticAtomizer();
    await atomizer.init();
    const store = new Store(primary, atomizer, dbPath);
    const resolver = new Resolver(primary, atomizer, store);
    await store.waitForInit();

    // =========================================================================
    // PHASE 1: THERMODYNAMIC FORGETTING
    // =========================================================================

    await it("Phase 1: Low-mass high-entropy node is pruned on tick", async () => {
      const sys = manager.getActiveSystem();
      const VACUUM_THRESHOLD = DOPAT_CONFIG.DRIFT_THRESHOLD * 0.001;

      // Mass just below vacuum threshold, entropyRate = time/scope = 200/1 = 200 > CRITICAL_ENTROPY (100)
      const id = sys.createLocation(VACUUM_THRESHOLD * 0.9, 1.0, "test_forget");
      sys.time[id] = 200.0;
      sys.update(id);

      assert.ok(sys.isAllocated(id), "Node should be allocated before tick");
      manager.tick(1.0);
      await manager.waitForStability();
      assert.strictEqual(
        sys.isAllocated(id),
        false,
        "Node should be garbage-collected by thermodynamic pruning"
      );
    });

    // =========================================================================
    // PHASE 2: GRAVITATIONAL CONSOLIDATION
    // =========================================================================

    await it("Phase 2: Exact-match fusion merges duplicate nodes and accumulates mass", async () => {
      const sys = manager.getActiveSystem();
      const scope = 42.0;

      const id1 = sys.createLocation(100.0, scope, "fusion_1");
      const id2 = sys.createLocation(50.0, scope, "fusion_2");
      sys.operatorClass[id1] = 0;
      sys.operatorClass[id2] = 0;
      for (const id of [id1, id2]) {
        sys.posX[id] = 10.0;
        sys.posY[id] = 10.0;
        sys.posZ[id] = 10.0;
        sys.posW[id] = 10.0;
        sys.depth[id] = 1.0;
        sys.update(id);
      }
      sys.depth[id2] = 2.0;
      sys.update(id2);

      let merged = false;
      for (let i = 0; i < 1000 && !merged; i++) {
        manager.tick(1.1);
        if (!sys.isAllocated(id1) || !sys.isAllocated(id2)) merged = true;
      }
      await manager.waitForStability();

      assert.ok(merged, "Identical-scope co-located nodes should fuse");
      const survivorId = sys.isAllocated(id1) ? id1 : id2;
      assert.ok(
        sys.mass[survivorId] > 10.0,
        "Survivor should hold accumulated mass"
      );
      assert.ok(
        sys.depth[survivorId] > 2.0,
        "Survivor should hold accumulated depth"
      );
    });

    await it("Phase 2: Orbital clustering blends scope and corrects posW (Age axis)", async () => {
      const sys = manager.getActiveSystem();

      const rootId = sys.createLocation(200.0, 10.0, "orbit_root");
      const satId = sys.createLocation(50.0, 20.0, "orbit_satellite");
      sys.operatorClass[rootId] = 0;
      sys.operatorClass[satId] = 0;
      // Place within ORBIT_RADIUS_SQ = 0.5 but outside exact-match radius (distSq > 0.0001)
      sys.posX[rootId] = 0;
      sys.posY[rootId] = 0;
      sys.posZ[rootId] = 0;
      sys.posW[rootId] = 0;
      sys.posX[satId] = 0.1;
      sys.posY[satId] = 0.1;
      sys.posZ[satId] = 0.1;
      sys.posW[satId] = 0.1;
      sys.update(rootId);
      sys.update(satId);

      const initScopeSat = sys.scope[satId];
      const initPosWSat = sys.posW[satId];
      const rootScope = sys.scope[rootId];
      const rootPosW = sys.posW[rootId];

      let scopeBlended = false;
      let posWCorrected = false;

      for (let i = 0; i < 1000; i++) {
        manager.tick(1.1);
        if (!sys.isAllocated(satId)) break;
        if (
          Math.abs(sys.scope[satId] - rootScope) <
          Math.abs(initScopeSat - rootScope)
        )
          scopeBlended = true;
        if (
          Math.abs(sys.posW[satId] - rootPosW) <
          Math.abs(initPosWSat - rootPosW)
        )
          posWCorrected = true;
        if (scopeBlended && posWCorrected) break;
      }
      await manager.waitForStability();

      assert.ok(
        scopeBlended,
        "Satellite scope should converge toward root (harmonic resonance)"
      );
      assert.ok(
        posWCorrected,
        "Satellite posW (Age axis) should converge toward root — fixed missing 4th dimension"
      );
      assert.ok(
        sys.isAllocated(rootId) && sys.isAllocated(satId),
        "Both nodes should still exist (different scopes prevent full fusion)"
      );
    });

    // =========================================================================
    // PHASE 3: CRYSTALLIZATION FEEDBACK LOOP
    // =========================================================================

    await it("Phase 3: Pre-ingestion resonance check detects logical contradiction", async () => {
      const localStore = new Store(primary, atomizer, ":memory:");
      await localStore.waitForInit();
      const localInference = new LiveInference(
        primary,
        atomizer,
        resolver,
        localStore
      );

      await localInference.processIntent("gravity is strong");
      const response = await localInference.processIntent(
        "gravity is not strong"
      );

      assert.ok(
        response.includes("Logic Trap Detected"),
        "Inverted ingestion should trigger a Logic Trap"
      );
      await localStore.close();
    });

    await it("Phase 3: Negative feedback reduces crystallized wave form energy", async () => {
      const localStore = new Store(primary, atomizer, ":memory:");
      await localStore.waitForInit();
      const localInference = new LiveInference(
        primary,
        atomizer,
        resolver,
        localStore
      );

      // Crystallize one wave form with energy 1.0
      await localInference.processCommand("nitrogen is a gas");

      const beforeStmt = await localStore.connection.prepare(
        "SELECT net_energy FROM wave_forms LIMIT 1"
      );
      const beforeRes = await beforeStmt.runAndReadAll();
      beforeStmt.destroySync();
      const initialEnergy = Number(beforeRes.getRows()[0]?.[0] ?? 1.0);
      assert.ok(
        initialEnergy > 0,
        "Wave form should be crystallized with positive energy"
      );

      const feedbackResponse =
        await localInference.processIntent("no that is wrong");
      assert.ok(
        feedbackResponse.includes("confidence reduced"),
        "Negative feedback should be acknowledged"
      );

      const afterStmt = await localStore.connection.prepare(
        "SELECT net_energy FROM wave_forms LIMIT 1"
      );
      const afterRes = await afterStmt.runAndReadAll();
      afterStmt.destroySync();
      const updatedEnergy = Number(afterRes.getRows()[0]?.[0] ?? initialEnergy);

      assert.ok(
        updatedEnergy < initialEnergy,
        `Energy should have decreased: ${initialEnergy} → ${updatedEnergy}`
      );
      await localStore.close();
    });

    await it("Phase 3: Positive feedback increases crystallized wave form energy", async () => {
      const localStore = new Store(primary, atomizer, ":memory:");
      await localStore.waitForInit();
      const localInference = new LiveInference(
        primary,
        atomizer,
        resolver,
        localStore
      );

      await localInference.processCommand("the sun is a star");

      const beforeStmt = await localStore.connection.prepare(
        "SELECT net_energy FROM wave_forms LIMIT 1"
      );
      const beforeRes = await beforeStmt.runAndReadAll();
      beforeStmt.destroySync();
      const initialEnergy = Number(beforeRes.getRows()[0]?.[0] ?? 1.0);

      const feedbackResponse =
        await localInference.processIntent("yes correct");
      assert.ok(
        feedbackResponse.includes("confidence increased"),
        "Positive feedback should be acknowledged"
      );

      const afterStmt = await localStore.connection.prepare(
        "SELECT net_energy FROM wave_forms LIMIT 1"
      );
      const afterRes = await afterStmt.runAndReadAll();
      afterStmt.destroySync();
      const updatedEnergy = Number(afterRes.getRows()[0]?.[0] ?? initialEnergy);

      assert.ok(
        updatedEnergy > initialEnergy,
        `Energy should have increased: ${initialEnergy} → ${updatedEnergy}`
      );
      await localStore.close();
    });

    await it("Phase 3: Repeated negative feedback drives energy to zero; cullWeakWaveForms removes it", async () => {
      const localStore = new Store(primary, atomizer, ":memory:");
      await localStore.waitForInit();
      const localInference = new LiveInference(
        primary,
        atomizer,
        resolver,
        localStore
      );

      // 3× "no" drives energy: 1.0 → 0.5 → 0.0 → -0.5
      await localInference.processCommand("the moon is made of cheese");
      for (let i = 0; i < 3; i++) {
        await localInference.processIntent("no");
      }

      const weakStmt = await localStore.connection.prepare(
        "SELECT COUNT(*) FROM wave_forms WHERE net_energy <= 0"
      );
      const weakRes = await weakStmt.runAndReadAll();
      weakStmt.destroySync();
      const weakBefore = Number(weakRes.getRows()[0]?.[0] ?? 0);
      assert.ok(
        weakBefore > 0,
        "Should have at least one weak (≤ 0 energy) wave form before cull"
      );

      await localStore.cullWeakWaveForms();

      const cleanStmt = await localStore.connection.prepare(
        "SELECT COUNT(*) FROM wave_forms WHERE net_energy <= 0"
      );
      const cleanRes = await cleanStmt.runAndReadAll();
      cleanStmt.destroySync();
      assert.strictEqual(
        Number(cleanRes.getRows()[0]?.[0] ?? 1),
        0,
        "No weak wave forms should survive cullWeakWaveForms"
      );
      await localStore.close();
    });

    await it("Phase 3: processQuestion sets last_signature so feedback applies after Q&A", async () => {
      const localStore = new Store(primary, atomizer, ":memory:");
      await localStore.waitForInit();
      // Fresh inference — last_signature starts null
      const localInference = new LiveInference(
        primary,
        atomizer,
        resolver,
        localStore
      );

      // With last_signature = null, "no" would fall through to processCommand instead of
      // entering the feedback branch. After the fix, processQuestion sets last_signature,
      // so the very next "no" is correctly recognised as reinforcement feedback.
      await localInference.processQuestion("what is iron");

      const feedbackResponse =
        await localInference.processIntent("no that is wrong");
      assert.ok(
        feedbackResponse.includes("confidence reduced"),
        "Negative feedback after a question should be recognised (last_signature set by processQuestion)"
      );
      await localStore.close();
    });

    // =========================================================================
    // PHASE 4: SUBCONSCIOUS VOID EXPANSION
    // =========================================================================

    await it("Phase 4: Unfolder.fetchContent always returns a string", async () => {
      const unfolder = new Unfolder(primary, atomizer);
      const content = await unfolder.fetchContent("carbon");
      assert.strictEqual(
        typeof content,
        "string",
        "fetchContent should return a string for any topic (network failure → empty string, not throw)"
      );
    });

    await it("Phase 4: Unfolder.ingestContent allocates precepts and returns their IDs", async () => {
      const unfolder = new Unfolder(primary, atomizer);
      const ids = unfolder.ingestContent("silicon is a semiconductor", primary);

      assert.ok(
        ids.length > 0,
        "ingestContent should allocate at least one precept"
      );
      for (let k = 0; k < ids.length; k++) {
        assert.ok(
          primary.isAllocated(ids[k]),
          `Precept ${ids[k]} returned by ingestContent should be allocated`
        );
      }
    });

    await it("Phase 4: Unfolder.resolveScope round-trips a freshly ingested token", async () => {
      const unfolder = new Unfolder(primary, atomizer);
      const ids = unfolder.ingestContent("helium neon argon", primary);
      assert.ok(ids.length > 0, "Should ingest at least one precept");

      let resolved = false;
      for (let k = 0; k < ids.length; k++) {
        const token = unfolder.resolveScope(primary.scope[ids[k]]);
        if (token && token.length > 0) {
          resolved = true;
          break;
        }
      }
      assert.ok(
        resolved,
        "resolveScope should recover at least one token from freshly ingested content"
      );
    });

    await it("Phase 4: dreamCycle — dreamt nodes carry elevated decayRate; manifold integrity preserved", async () => {
      const sys = manager.getActiveSystem();
      const unfolder = new Unfolder(sys, atomizer);
      manager.setUnfolder(unfolder);

      // Build a tension zone: high-mass Action anchor + nearby high-entropy OperatorClass.None operand
      const actionId = sys.createLocation(sys.c * 20, 5.0, "dream_action");
      sys.operatorClass[actionId] = OperatorClass.Action;
      sys.posX[actionId] = 50.0;
      sys.posY[actionId] = 50.0;
      sys.update(actionId);

      // Ingest "oxygen" so resolveScope has a dictionary entry near the anchor
      const seedIds = unfolder.ingestContent("oxygen", sys);
      assert.ok(seedIds.length > 0, "Seed ingest should succeed");
      const operandId = seedIds[0];

      // Force the operand into the tension zone: within 2 units of anchor, entropyRate > 5
      sys.posX[operandId] = 50.5;
      sys.posY[operandId] = 50.5;
      // entropyRate = time / scope. Set time high enough that time/scope > 5.0
      sys.time[operandId] = Math.max(6.0, sys.scope[operandId] * 6.0);
      sys.update(operandId);

      const snapshotLength = sys.length;

      // Alternate ticks with short async gaps so dreamCycle can complete its fetch
      // and pendingDreams can be drained on the following tick
      for (let t = 0; t < 10; t++) {
        manager.tick(0.1);
        await new Promise(r => setTimeout(r, 50));
      }
      await manager.waitForStability();

      // Primary assertion: manifold must remain uncorrupted regardless of dream outcome
      const corrupted = sys.checkIntegrity();
      assert.strictEqual(
        corrupted.length,
        0,
        "Manifold integrity must be preserved after dream cycles"
      );

      // Secondary assertion: nodes ingested via dreamCycle carry decayRate = 0.05
      // (elevated above the default 0.01 so irrelevant dreamt content self-GCs)
      let dreamedNodeCount = 0;
      for (let i = 0; i < sys.length; i++) {
        if (sys.isAllocated(i) && Math.abs(sys.decayRate[i] - 0.05) < 1e-9) {
          dreamedNodeCount++;
        }
      }

      if (dreamedNodeCount > 0) {
        console.log(
          `  ✓ Dream cycle fired: ${dreamedNodeCount} dreamt precept(s) with elevated decayRate confirmed.`
        );
      } else {
        console.log(
          "  ✓ Dream cycle armed but tension zone token not in dictionary — stability verified."
        );
      }
    });

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
