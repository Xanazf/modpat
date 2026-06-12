import { TMRFreeList } from "@_lib/checksum/TMRFreeList";
import { DatabaseContext } from "@_lib/persistence/DatabaseContext";
import assert from "node:assert";
import type SpectralAtomizer from "@atomics/SpectralAtomizer";
import { DOPAT_CONFIG } from "@config";
import { OperatorClass } from "@core_i/System";
import { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";
import { SystemPersistence } from "@core_s/Persistence";
import { DeltaQueue } from "@mutate/DeltaQueue";
import logger from "@utils/SpectralLogger";
import {
  describe,
  it,
  type TestEnvironment,
  TestHarness,
} from "./utils/harness";

export async function executeSignalManagerSuite() {
  await describe("SIGNALING & MANIFOLD MANAGER SUITE", async () => {
    const env: TestEnvironment<SpectralAtomizer> =
      await TestHarness.getEnvironment("spectral");
    const emergencySystem = (await TestHarness.getEnvironment("base")).system;

    const dbCtx = new DatabaseContext(":memory:");
    const dbConn = await dbCtx.connect();
    const persistence = new SystemPersistence(dbConn);
    const manager = new ManifoldLifecycle(
      env.system,
      emergencySystem,
      persistence
    );

    await it("Test 1: RF Spectral Ingestion & Peak Mapping", async () => {
      const samples = new Float32Array(128);
      const targetFreq = 10;
      const sampleRate = 128;
      for (let i = 0; i < samples.length; i++) {
        samples[i] = Math.sin(2 * Math.PI * targetFreq * (i / sampleRate));
      }

      const peakIds = env.atomizer.ingestRF(samples, sampleRate, env.system);
      assert.ok(
        peakIds.length > 0,
        "Should detect spectral peaks from sine wave"
      );

      const peakId = peakIds[0];
      const detectedFreq = env.system.scope[peakId];
      const detectedMass = env.system.mass[peakId];
      logger.log(`  [RF] Peak Detected at ID ${peakId}`);
      logger.log(
        `  [RF] Frequency: ${detectedFreq.toFixed(2)}Hz (Target: ${targetFreq}Hz)`
      );
      logger.log(`  [RF] Magnitude (Mass): ${detectedMass.toFixed(2)}`);

      assert.ok(
        Math.abs(detectedFreq - targetFreq) < 1.0,
        "Frequency mapping must be accurate within 1Hz"
      );
      assert.ok(
        detectedMass > 0,
        "Signal amplitude must translate to positive physical Mass"
      );
    });

    await it("Test 2: Telemetry Projection & GPS Drift Navigation", async () => {
      const gps = { lat: 37.7749, lon: -122.4194 };
      const imu = { pitch: 0.1, roll: 0.0, yaw: 0.5 };

      logger.log("  [GPS] Ingesting static position...");
      const normalIds = env.atomizer.ingestTelemetry(
        gps,
        imu,
        false,
        env.system
      );
      assert.strictEqual(
        normalIds.length,
        1,
        "Should create exactly one resonance precept for stable GPS"
      );
      assert.strictEqual(env.system.posX[normalIds[0]], gps.lon);
      assert.strictEqual(env.system.posY[normalIds[0]], gps.lat);

      logger.log("  [GPS] Simulating sensor drift / signal jamming...");
      const driftIds = env.atomizer.ingestTelemetry(gps, imu, true, env.system);
      assert.strictEqual(
        driftIds.length,
        2,
        "Should inject a secondary 'Void' precept during drift"
      );
      const voidId = driftIds[1];
      logger.log(
        `  [GPS] Void Precept created at ID ${voidId} with Mass: ${env.system.mass[voidId].toFixed(2)}`
      );

      assert.strictEqual(
        env.system.operatorClass[voidId],
        OperatorClass.Inversion,
        "Drift Void must act as an Inversion (NOT) operator"
      );
      assert.ok(
        env.system.mass[voidId] < 0,
        "Drift Void must have negative mass to repel geodesics"
      );
    });

    await it("Test 3: Triple Modular Redundancy (TMR) Hardware Hardening", async () => {
      logger.log("  [TMR] Pushing IDs into redundant free-list...");
      manager.pushToFreeList(500);
      manager.pushToFreeList(501);

      const firstPop = manager.popFromFreeList();
      assert.strictEqual(
        firstPop,
        501,
        "Majority vote should return last pushed value"
      );

      logger.log("  [TMR] Simulating memory corruption in sub-module A...");
      manager.primaryAllocator.injectCorruptionToBufferA(9999);

      const securePop = manager.popFromFreeList();
      logger.log(
        `  [TMR] Majority Voter retrieved: ${securePop} (Ignored corrupted 9999)`
      );
      assert.strictEqual(
        securePop,
        500,
        "Voter must successfully ignore the outlier and return the majority consensus"
      );
    });

    await it("Test 4: Emergency Manifold Interrupt & Hot-Swap", async () => {
      assert.strictEqual(
        manager.getActiveSystem(),
        env.system,
        "Initial state must be Primary system"
      );

      logger.log(
        "  [Manager] Injecting supermassive collision-imminent threat..."
      );
      const threatId = env.system.createLocation(env.system.c ** 2 * 5000.0, 0);
      env.system.decayRate[threatId] = 100.0;

      logger.log("  [Manager] Monitoring manifold for critical interrupts...");
      await manager.monitorThreats();

      assert.strictEqual(
        manager.getActiveSystem(),
        emergencySystem,
        "Manager must hot-swap to Emergency System when threat detected"
      );

      await manager.waitForStability();
    });

    await it("Test 5: Temporal Resonance Decay (Matter Half-Life)", async () => {
      const startMass = env.system.c ** 2;
      const startAge = 5.0;
      const startX = 80.0;
      const decayingId = env.system.createLocation(startMass, 20);
      env.system.time[decayingId] = startAge;
      env.system.posX[decayingId] = startX;

      logger.log(
        `  [Decay] Precept ${decayingId} - Initial Mass: ${startMass.toFixed(2)}, Age: ${startAge}`
      );
      logger.log("  [Decay] Advancing system time (dt=50000.0)...");
      env.system.decay(50000.0);

      const finalMass = env.system.mass[decayingId];
      const finalAge = env.system.time[decayingId];
      const finalX = env.system.posX[decayingId];

      logger.log(
        `  [Decay] Precept ${decayingId} - Final Mass: ${finalMass.toFixed(2)}, Age: ${finalAge.toFixed(2)}`
      );
      assert.ok(
        finalMass < startMass,
        "Mass must decrease according to exponential decay"
      );
      assert.ok(
        finalAge > startAge,
        "Age must increase linearly with simulation time"
      );

      env.system.decayRate[decayingId] = 1.0;
      env.system.decay(1000.0);
      logger.log(
        `  [Decay] Spatial position drifted from ${startX} to ${env.system.posX[decayingId].toFixed(2)}`
      );
      assert.ok(
        env.system.posX[decayingId] < startX,
        "Decayed resonance must drift toward manifold origin"
      );
    });

    // TMR 5a hardening tests (isolated allocator, not the shared manager one)

    await it("Test 6: TMR single-buffer CRC corruption corrected by majority vote", async () => {
      const tmr = new TMRFreeList();
      tmr.push(5);
      tmr.push(10);
      tmr.push(15);

      // Corrupt index 1 (value 10) in buffer 0, CRC becomes stale.
      tmr.corruptBuffer(0, 1, 0xff);

      // CRC check detects buffer 0 is stale; vote uses buffers 1 and 2.
      const v = tmr.pop();
      assert.strictEqual(
        v,
        15,
        "pop must return correct tail value despite single-buffer corruption"
      );

      // After pop all three buffers are normalised to [5, 10], outlier resynced.
      assert.ok(
        tmr.allBuffersIdentical(),
        "all buffers must be identical after the majority-vote resync"
      );
      assert.ok(tmr.verify(), "CRCs must be valid after resync");
      assert.ok(
        !tmr.isHalted(),
        "allocator must NOT be halted after correctable corruption"
      );

      // Verify the resynced buffer contains correct values.
      const v2 = tmr.pop();
      assert.strictEqual(
        v2,
        10,
        "second pop must return the correct value from resynced buffer"
      );
      const v3 = tmr.pop();
      assert.strictEqual(
        v3,
        5,
        "third pop must drain correctly after full resync"
      );
    });

    await it("Test 7: TMR three-way disagreement halts allocation", async () => {
      const tmr = new TMRFreeList();
      tmr.push(1);
      tmr.push(2);
      tmr.push(3);

      // Corrupt all three buffers differently, no majority possible.
      tmr.corruptBuffer(0, 1, 0xaa);
      tmr.corruptBuffer(1, 1, 0xbb);
      tmr.corruptBuffer(2, 1, 0xcc);

      // Record quarantine events via the interrupt handler.
      const quarantineEvents: string[] = [];
      tmr.setInterruptHandler(reason => quarantineEvents.push(reason));

      const v = tmr.pop();
      assert.strictEqual(
        v,
        undefined,
        "pop must return undefined on three-way disagreement"
      );
      assert.ok(
        tmr.isHalted(),
        "allocator must be halted after three-way disagreement"
      );
      assert.ok(
        quarantineEvents.length > 0,
        "interrupt handler must have been called with the quarantine reason"
      );

      // Subsequent pops must also return undefined (allocator is halted).
      assert.strictEqual(
        tmr.pop(),
        undefined,
        "halted allocator must continue to return undefined"
      );
    });

    // Track 6 - DeltaQueue concurrency model

    await it("Test 8: DeltaQueue unit - drain returns all posted records and resets length", async () => {
      const dq = new DeltaQueue(100);
      assert.strictEqual(dq.length, 0);

      dq.post({ kind: "free", id: 1 });
      dq.post({ kind: "free", id: 2 });
      dq.post({ kind: "update", id: 0, field: "mass", value: 99 });
      assert.strictEqual(dq.length, 3);

      const batch = dq.drain();
      assert.strictEqual(batch.length, 3);
      assert.strictEqual(dq.length, 0, "length resets to 0 after drain");

      const second = dq.drain();
      assert.strictEqual(
        second.length,
        0,
        "drain on empty queue returns empty array"
      );
    });

    await it("Test 9: ManifoldLifecycle - FreeDelta is buffered until tick()", async () => {
      const base2 = await TestHarness.getEnvironment("base");
      const emergency2 = (await TestHarness.getEnvironment("base")).system;
      const dbCtx2 = new DatabaseContext(":memory:");
      const dbConn2 = await dbCtx2.connect();
      const persistence2 = new SystemPersistence(dbConn2);
      const manager2 = new ManifoldLifecycle(
        base2.system,
        emergency2,
        persistence2
      );

      const id = base2.system.createLocation(base2.system.c ** 2, 0);
      assert.ok(
        base2.system.isAllocated(id),
        "precept must be allocated before posting delta"
      );

      manager2.postDelta({ kind: "free", id });

      assert.ok(
        base2.system.isAllocated(id),
        "FreeDelta must NOT take effect before tick()"
      );

      manager2.tick(DOPAT_CONFIG.DELTA);

      assert.ok(
        !base2.system.isAllocated(id),
        "FreeDelta must take effect inside tick()"
      );

      await dbCtx2.close();
      await TestHarness.disposeEnvironment(base2);
    });

    await dbCtx.close();
    await TestHarness.disposeEnvironment(env);
    logger.log("\nSignal & Manager Suite Passed Successfully.");
  });
}
