import { DOPAT_CONFIG } from "@config";
import System from "@core_i/System";
import type { TargetBuffer } from "@core_i/System";
import { OperatorClass, SystemRef } from "@core_i/System";
import { DeltaQueue } from "@core_s/DeltaQueue";
import { metrics } from "@core_s/Metrics";
import type Unfolder from "@core_s/Unfolder";
import { GridIndex4D } from "@src/core/structural/GridIndex4D";
import type { SystemPersistence } from "./Persistence";

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Hardened Triple Modular Redundancy free-list allocator (Option 5a).
 *
 * Each buffer carries a CRC32 checksum updated on every push/pop.
 * On vote:
 *  - CRC mismatch on one buffer → two-out-of-three majority silently corrects it.
 *  - CRC mismatch on two or three buffers, or value disagreement with all CRCs valid
 *    → quarantine: allocation halted, interruptHandler fired, tmr.total_disagree incremented.
 *
 * Normal (no-corruption) pop increments tmr.agree.
 * Majority-corrected pop increments tmr.corrected.
 */
export class TMRFreeList implements Root.FreeList {
  private bufA: number[] = [];
  private bufB: number[] = [];
  private bufC: number[] = [];
  /** CRC32 checksum for each buffer, updated on every mutation. */
  private crcA = 0;
  private crcB = 0;
  private crcC = 0;
  /** Cached length; updated by push/pop so callers don't pay CRC cost on every read. */
  private _length = 0;
  private _halted = false;
  private _interruptHandler:
    | ((reason: string, values: number[]) => void)
    | null = null;

  /** Register a callback invoked on quarantine (three-way disagreement). */
  setInterruptHandler(h: (reason: string, values: number[]) => void): void {
    this._interruptHandler = h;
  }

  push(id: number): void {
    this.bufA.push(id);
    this.crcA = this.crc32(this.bufA);
    this.bufB.push(id);
    this.crcB = this.crc32(this.bufB);
    this.bufC.push(id);
    this.crcC = this.crc32(this.bufC);
    this._length++;
  }

  pop(): number | undefined {
    if (this._halted) return undefined;
    const { winner, corrected, failed } = this.computeVote();

    if (failed) {
      const top = [
        this.bufA.at(-1) ?? -1,
        this.bufB.at(-1) ?? -1,
        this.bufC.at(-1) ?? -1,
      ];
      this.quarantine("pop: three-way disagreement", top);
      return undefined;
    }
    if (winner!.length === 0) return undefined;

    metrics.increment(corrected ? "tmr.corrected" : "tmr.agree");

    const id = winner![winner!.length - 1];
    const next = winner!.slice(0, -1);
    // Normalise all three buffers to the agreed state (implicit resync of any outlier).
    this.bufA = [...next];
    this.crcA = this.crc32(this.bufA);
    this.bufB = [...next];
    this.crcB = this.crc32(this.bufB);
    this.bufC = [...next];
    this.crcC = this.crc32(this.bufC);
    this._length = next.length;
    return id;
  }

  get length(): number {
    return this._length;
  }

  /** Returns the consensus list, or null on total disagreement. */
  getVoted(): number[] | null {
    if (this._halted) return null;
    const { winner, failed } = this.computeVote();
    return failed ? null : [...winner!];
  }

  /** Test-only: push a value into bufA only, simulating silent buffer corruption. */
  injectCorruptionToBufferA(value: number): void {
    this.bufA.push(value);
    // Does NOT update crcA, CRC mismatch triggers correction on next vote.
  }

  /**
   * Test-only: overwrite a specific slot in one buffer without refreshing its CRC.
   * Simulates a single-bit flip; detected by the CRC check in computeVote().
   */
  corruptBuffer(
    bufferIndex: 0 | 1 | 2,
    offset: number,
    newValue: number
  ): void {
    const buf =
      bufferIndex === 0 ? this.bufA : bufferIndex === 1 ? this.bufB : this.bufC;
    if (offset >= 0 && offset < buf.length) buf[offset] = newValue;
    // Intentionally stale CRC after this call.
  }

  /** Returns true iff all three buffers currently hold identical contents. */
  allBuffersIdentical(): boolean {
    return (
      arraysEqual(this.bufA, this.bufB) && arraysEqual(this.bufB, this.bufC)
    );
  }

  isHalted(): boolean {
    return this._halted;
  }

  /** Returns true iff all three CRCs match their buffers (no undetected corruption). */
  verify(): boolean {
    return (
      this.crc32(this.bufA) === this.crcA &&
      this.crc32(this.bufB) === this.crcB &&
      this.crc32(this.bufC) === this.crcC
    );
  }

  private computeVote(): {
    winner: number[] | null;
    corrected: boolean;
    failed: boolean;
  } {
    const aOk = this.crc32(this.bufA) === this.crcA;
    const bOk = this.crc32(this.bufB) === this.crcB;
    const cOk = this.crc32(this.bufC) === this.crcC;
    const nFail = (aOk ? 0 : 1) + (bOk ? 0 : 1) + (cOk ? 0 : 1);

    if (nFail >= 2) return { winner: null, corrected: false, failed: true };

    // Exactly one CRC failure, the other two are the winners.
    if (!aOk) return { winner: this.bufB, corrected: true, failed: false };
    if (!bOk) return { winner: this.bufA, corrected: true, failed: false };
    if (!cOk) return { winner: this.bufA, corrected: true, failed: false };

    // All CRCs valid, value comparison for silent disagreements.
    if (arraysEqual(this.bufA, this.bufB) && arraysEqual(this.bufB, this.bufC))
      return { winner: this.bufA, corrected: false, failed: false };
    if (arraysEqual(this.bufA, this.bufB))
      return { winner: this.bufA, corrected: true, failed: false };
    if (arraysEqual(this.bufA, this.bufC))
      return { winner: this.bufA, corrected: true, failed: false };
    if (arraysEqual(this.bufB, this.bufC))
      return { winner: this.bufB, corrected: true, failed: false };

    return { winner: null, corrected: false, failed: true };
  }

  private quarantine(reason: string, values: number[]): void {
    this._halted = true;
    metrics.increment("tmr.total_disagree");
    this._interruptHandler?.(reason, values);
  }

  /** CRC-32 (IEEE 802.3 polynomial) over an array of 32-bit integers. */
  private crc32(arr: number[]): number {
    let crc = 0xffffffff;
    for (const v of arr) {
      let x = v >>> 0;
      for (let i = 0; i < 4; i++) {
        let byte = x & 0xff;
        for (let j = 0; j < 8; j++) {
          const bit = (crc ^ byte) & 1;
          crc = (crc >>> 1) ^ (bit ? 0xedb88320 : 0);
          byte >>>= 1;
        }
        x >>>= 8;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}

/**
 * The ManifoldLifecycle acts as the guardian and regulator of the logical manifolds.
 *
 * It manages both the primary and emergency systems, ensuring universal
 * integrity through self-healing routines, Triple Modular Redundancy (TMR),
 * and continuous monitoring for high-mass "threats" that could destabilize
 * the logical topology.
 */
export class ManifoldLifecycle {
  /** The primary logical universe. */
  public primarySystem: System;
  /** A parallel backup universe, used when the primary system encounters a critical anomaly. */
  public emergencySystem: System;
  /** Shared mutable reference cell, components hold this and always see the active system. */
  private systemRef: SystemRef;
  /** Persistence layer for snapshotting and hydrating the manifold. */
  private persistence: SystemPersistence;
  /** The currently active logical universe. */
  private activeSystem: System;

  /** TMR allocators, one per system, injected via System.setAllocator(). */
  readonly primaryAllocator = new TMRFreeList();
  private readonly emergencyAllocator = new TMRFreeList();
  /** Tracks which allocator matches the currently active system. */
  private activeAllocator: TMRFreeList;

  /** Flag to prevent race conditions during asynchronous self-healing hydration. */
  private isHydrating: boolean = false;
  /** Promise tracking the current hydration process. */
  private stabilityPromise: Promise<void> | null = null;

  /** Typed delta queue - the only path through which async code mutates the manifold. */
  private readonly deltaQueue = new DeltaQueue(
    DOPAT_CONFIG.structural.DELTA_QUEUE_MAX
  );
  /** Guard preventing concurrent dream cycles. */
  private isDreaming: boolean = false;
  /** Cursor for batched monitorThreats scan - advances each tick so a full sweep
   *  spans multiple ticks rather than blocking the event loop for O(N). */
  private _threatCursor = 0;
  private static readonly THREAT_BATCH = 5_000;
  /** External knowledge expansion engine for Phase 4 (Subconscious Void Expansion). */
  private unfolder: Unfolder | null = null;

  /**
   * Initializes the Manifold Manager with primary and emergency systems.
   *
   * @param primary - The main logic system.
   * @param emergency - The backup logic system.
   * @param persistence - The persistence manager.
   */
  constructor(
    primary: System,
    emergency: System,
    persistence: SystemPersistence
  ) {
    this.primarySystem = primary;
    this.emergencySystem = emergency;
    this.persistence = persistence;
    this.activeSystem = primary;
    this.systemRef = new SystemRef(primary);
    this.activeAllocator = this.primaryAllocator;

    // Wire TMR allocators into each system's allocation path.
    primary.setAllocator(this.primaryAllocator);
    emergency.setAllocator(this.emergencyAllocator);

    // Route TMR quarantine events to the manifold interrupt handler.
    const makeQuarantineHandler =
      (label: string) => (reason: string, _values: number[]) => {
        this.triggerInterrupt(`TMR quarantine [${label}]: ${reason}`).catch(
          err => {
            console.error(`[ManifoldLifecycle] TMR interrupt error:`, err);
          }
        );
      };
    this.primaryAllocator.setInterruptHandler(makeQuarantineHandler("primary"));
    this.emergencyAllocator.setInterruptHandler(
      makeQuarantineHandler("emergency")
    );
  }

  /**
   * Retrieves the currently active logical manifold.
   */
  public getActiveSystem(): System {
    return this.activeSystem;
  }

  /**
   * Returns the shared SystemRef that components should hold.
   * When a failover fires, all holders are redirected atomically via the ref.
   */
  public getSystemRef(): SystemRef {
    return this.systemRef;
  }

  /**
   * Returns a safe clone of the voted free-list from the active system's TMR allocator.
   * Triggers an emergency interrupt on total disagreement.
   */
  public getVotedFreeList(): number[] {
    const voted = this.activeAllocator.getVoted();
    if (voted === null) {
      this.triggerInterrupt("TMR Failure: Complete loss of FreeList consensus");
      return [];
    }
    return voted;
  }

  /**
   * Pushes an ID to the active system's TMR allocator (all three buffers).
   */
  public pushToFreeList(id: number): void {
    this.activeAllocator.push(id);
  }

  /**
   * Pops an ID from the active system's TMR allocator using majority vote.
   * @returns A reclaimed ID, or undefined if the list is empty.
   */
  public popFromFreeList(): number | undefined {
    return this.activeAllocator.pop();
  }

  /**
   * Background process to verify the integrity of the active manifold.
   *
   * If corrupted logic atoms (precepts) are detected, it triggers a
   * self-healing routine that re-hydrates the system from the
   * persistent store (DuckDB).
   */
  public async selfHealRoutine(): Promise<void> {
    if (this.isHydrating) return this.stabilityPromise || Promise.resolve();

    const corruptedIds = this.activeSystem.checkIntegrity();
    if (corruptedIds.length > 0) {
      console.warn(
        `[ManifoldLifecycle] Detected ${corruptedIds.length} corrupted precepts. Initiating self-healing...`
      );
      this.isHydrating = true;
      const newSystem = new System();
      const newAllocator = new TMRFreeList();
      newSystem.setAllocator(newAllocator);
      newAllocator.setInterruptHandler((reason, values) => {
        this.triggerInterrupt(`TMR quarantine [self-healed]: ${reason}`).catch(
          err => {
            console.error(`[ManifoldLifecycle] TMR interrupt error:`, err);
          }
        );
      });

      this.stabilityPromise = newSystem
        .hydrate(this.persistence)
        .then(() => {
          console.log(`[ManifoldLifecycle] Self-healing complete.`);
          this.activeSystem = newSystem;
          this.activeAllocator = newAllocator;
          this.systemRef.swap(newSystem);
        })
        .finally(() => {
          this.isHydrating = false;
          this.stabilityPromise = null;
        });
      await this.stabilityPromise;
    }
  }

  /**
   * Emergency protocol that instantly swaps the active manifold.
   *
   * Triggered when a critical threat (e.g., a topological collapse
   * or high-mass anomaly) is detected in the primary system.
   *
   * @param reason - Descriptive reason for the interrupt.
   */
  public async triggerInterrupt(reason: string): Promise<void> {
    console.error(
      `[ManifoldLifecycle] CRITICAL INTERRUPT: ${reason}. Switching to Emergency Manifold!`
    );

    // Attempt to hydrate emergency system from persistence to prevent operating on stale/empty state
    if (this.isHydrating) return this.stabilityPromise || Promise.resolve();

    this.isHydrating = true;
    const targetSystem =
      this.activeSystem === this.primarySystem
        ? this.emergencySystem
        : this.primarySystem;
    const targetAllocator =
      this.activeSystem === this.primarySystem
        ? this.emergencyAllocator
        : this.primaryAllocator;

    this.stabilityPromise = targetSystem
      .hydrate(this.persistence)
      .then(() => {
        console.log(
          `[ManifoldLifecycle] Emergency Manifold hydrated successfully.`
        );
        this.activeSystem = targetSystem;
        this.activeAllocator = targetAllocator;
        // Atomically redirect all SystemRef holders to the emergency system.
        this.systemRef.swap(targetSystem);
      })
      .catch(err => {
        console.error(
          `[ManifoldLifecycle] Failed to hydrate Emergency Manifold:`,
          err
        );
      })
      .finally(() => {
        this.isHydrating = false;
        this.stabilityPromise = null;
      });

    await this.stabilityPromise;
  }

  /**
   * Scans the active manifold for high-mass anomalies.
   *
   * Anomalies are defined as logic atoms with excessive matter mass
   * and high decay rates, which can destabilize the surrounding topology.
   */
  public async monitorThreats(): Promise<void> {
    const sys = this.activeSystem;
    // S8 fix: scan one batch per tick instead of all N precepts.
    // The cursor wraps around so a full sweep completes over multiple ticks.
    const batchEnd = Math.min(
      this._threatCursor + ManifoldLifecycle.THREAT_BATCH,
      sys.length
    );
    for (let i = this._threatCursor; i < batchEnd; i++) {
      if (
        Math.abs(sys.mass[i]) > sys.c ** 2 * 1000.0 &&
        sys.decayRate[i] > 50.0
      ) {
        await this.triggerInterrupt("High-mass anomaly detected");
        this._threatCursor = 0; // reset so next sweep starts fresh
        return;
      }
    }
    this._threatCursor = batchEnd >= sys.length ? 0 : batchEnd;
  }

  /**
   * Wires the knowledge expansion engine for Phase 4 (Subconscious Void Expansion).
   * Must be called before tick() for dreamCycle to activate.
   */
  public setUnfolder(unfolder: Unfolder): void {
    this.unfolder = unfolder;
    // Wire the delta sink so Unfolder.expand() posts through the DeltaQueue
    // instead of writing to the manifold directly.
    unfolder.setDeltaSink(delta => this.deltaQueue.post(delta));
  }

  /**
   * Phase 4: Subconscious Void Expansion
   * Runs asynchronously during low-pressure idle ticks to detect tension zones
   * (high-entropy operands near high-mass action anchors) and pre-fetches
   * relevant knowledge, queuing it for safe synchronous ingestion on the next tick.
   */
  private async dreamCycle(): Promise<void> {
    if (this.isDreaming || !this.unfolder) return;

    // Shed load when the delta queue is filling up - prevents fetch bursts.
    if (this.deltaQueue.length >= DOPAT_CONFIG.structural.PENDING_DREAMS_MAX) {
      metrics.increment("dream.queue_full");
      return;
    }

    const sys = this.activeSystem;
    const pressure =
      (sys.length - this.activeAllocator.length) / DOPAT_CONFIG.MAX_PRECEPTS;
    if (pressure > 0.5) {
      metrics.increment("dream.rejected_pressure");
      return;
    }
    metrics.increment("dream.started");

    this.isDreaming = true;
    try {
      const VACUUM_THRESHOLD = sys.c * 0.01;
      const MAX_ZONES = DOPAT_CONFIG.structural.DREAM_ZONES_PER_CYCLE;
      let zonesThisCycle = 0;

      // Collect high-mass action anchors (conceptually active operators)
      const actionAnchors: number[] = [];
      for (let i = 0; i < sys.length; i++) {
        if (!sys.isAllocated(i)) continue;
        if (
          (sys.operatorClass[i] === OperatorClass.Action ||
            sys.operatorClass[i] === OperatorClass.IdentityShift) &&
          sys.mass[i] > sys.c * 10
        ) {
          actionAnchors.push(i);
        }
      }
      if (actionAnchors.length === 0) return;

      // Find a tension zone: isolated high-entropy operand near an action anchor
      for (let i = 0; i < sys.length; i++) {
        if (!sys.isAllocated(i)) continue;
        if (sys.operatorClass[i] !== OperatorClass.None) continue;
        if (
          sys.entropyRate[i] < 1e-6 ||
          Math.abs(sys.mass[i]) < VACUUM_THRESHOLD
        )
          continue;

        let nearAnchor = false;
        for (const a of actionAnchors) {
          const dx = sys.posX[i] - sys.posX[a];
          const dy = sys.posY[i] - sys.posY[a];
          if (dx * dx + dy * dy < 4.0) {
            nearAnchor = true;
            break;
          }
        }
        if (!nearAnchor) continue;

        // S11 fix: walk the PartLayer chain from this atom to collect
        // up to 3 consecutive tokens, reconstructing multi-word concepts
        // (e.g. "neural network") instead of returning a single token.
        const tokenParts: string[] = [];
        let cur = i;
        for (let hop = 0; hop < 3 && cur !== 0 && sys.isAllocated(cur); hop++) {
          const part = this.unfolder.resolveScope(sys.scope[cur]);
          if (part && part.length > 1) tokenParts.push(part);
          cur = sys.PartLayer[cur] ?? 0;
        }
        const token = tokenParts.join(" ").trim();
        if (!token || token.length <= 2) continue;

        const content = await this.unfolder.fetchContent(token);
        if (content) {
          this.deltaQueue.post({
            kind: "ingest",
            text: content,
            basePosX: sys.posX[i],
            basePosY: sys.posY[i],
            factDisplacementZ: 0,
          });
          metrics.increment("dream.ingested");
          if (++zonesThisCycle >= MAX_ZONES) break;
        }
      }
    } finally {
      this.isDreaming = false;
    }
  }

  /**
   * Phase 2: Gravitational Consolidation
   * Runs in the background to merge exact matches and pull similar concepts into orbits.
   *
   * Uses a throwaway GridIndex4D built from allocated semantic atoms so that each
   * sampled node queries only nearby cells (O(1) per sample at moderate density)
   * instead of scanning the full manifold (previously O(N) per sample → O(sweeps×N)).
   */
  private _consolidationCursor = 0;

  private consolidationRoutine(dt: number): void {
    const sys = this.activeSystem;
    const activeNodes = sys.length - this.activeAllocator.length;
    const pressure = activeNodes / DOPAT_CONFIG.MAX_PRECEPTS;

    const ORBIT_RADIUS_SQ = DOPAT_CONFIG.mapper.ORBIT_RADIUS_SQ;
    const orbitRadius = Math.sqrt(ORBIT_RADIUS_SQ);
    // Cell size must be ≤ orbit radius so that all candidates within range
    // fall into the queried cell or its direct neighbours.
    const cellSize = Math.max(orbitRadius, 0.5);

    // Build a throwaway spatial index of allocated semantic atoms.
    const grid = new GridIndex4D(cellSize);
    const semanticIds: number[] = [];
    for (let i = 0; i < sys.length; i++) {
      if (!sys.isAllocated(i)) continue;
      if (sys.operatorClass[i] !== 0) continue;
      grid.insert(i, sys.posX[i], sys.posY[i], sys.posZ[i], sys.posW[i]);
      semanticIds.push(i);
    }
    if (semanticIds.length < 2) return;

    // Throttle: partial sweep per tick, scaled by pressure.
    const sweeps =
      pressure > 0.8
        ? DOPAT_CONFIG.structural.CONSOLIDATION_ITERS_PER_TICK[1]
        : DOPAT_CONFIG.structural.CONSOLIDATION_ITERS_PER_TICK[0];

    // S9 fix: use a cursor so consecutive ticks walk the semantic atom list
    // sequentially instead of picking random targets that may repeat.
    if (this._consolidationCursor >= semanticIds.length)
      this._consolidationCursor = 0;

    for (let k = 0; k < sweeps; k++) {
      const i = semanticIds[this._consolidationCursor % semanticIds.length];
      this._consolidationCursor++;

      // Query only the local grid neighbourhood instead of the full manifold.
      const candidates = grid.candidatesInRadius(
        sys.posX[i],
        sys.posY[i],
        sys.posZ[i],
        sys.posW[i],
        orbitRadius
      );

      for (const j of candidates) {
        if (j === i || !sys.isAllocated(j)) continue;

        // Fine-grained 4D distance check.
        const dx = sys.posX[i] - sys.posX[j];
        const dy = sys.posY[i] - sys.posY[j];
        const dz = sys.posZ[i] - sys.posZ[j];
        const dw = sys.posW[i] - sys.posW[j];
        const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
        if (distSq >= ORBIT_RADIUS_SQ) continue;

        // Determine Root (heaviest mass)
        const root = sys.mass[i] > sys.mass[j] ? i : j;
        const satellite = root === i ? j : i;

        // Exact-match fusion: nodes that are effectively co-located AND share
        // the same scope are duplicates - absorb the satellite into the root.
        // This handles atoms that were placed at identical coordinates (e.g.
        // by two ingestion passes for the same fact) and would never converge
        // through the gentle pull alone (pull magnitude is proportional to
        // distance, so coincident nodes never move).
        const FUSION_DIST_SQ = ORBIT_RADIUS_SQ * 0.01;
        if (distSq <= FUSION_DIST_SQ && sys.scope[i] === sys.scope[j]) {
          sys.mass[root] += sys.mass[satellite];
          sys.depth[root] += sys.depth[satellite]; // accumulate, not max
          sys.update(root, "exact_match_fusion");
          sys.freeLocation(satellite, "exact_match_fusion");
          break; // satellite is freed; move on to the next i
        }

        // Gently pull satellite toward root across all relevant dimensions.
        // Pull is scaled to elapsed-time seconds so the rate is independent
        // of tick frequency.
        const pull = 0.1 * (dt / 1000);

        // Matter (posX) - primary gravitational attraction.
        sys.posX[satellite] += (sys.posX[root] - sys.posX[satellite]) * pull;

        // Age axis (posW) - temporal resonance alignment.
        sys.posW[satellite] += (sys.posW[root] - sys.posW[satellite]) * pull;

        // NOTE: scope is NOT blended here. Scope is a discrete concept-identity
        // tag used as a key in the scopeIndex Map; writing a float interpolation
        // to scope[] silently removes the atom from the scope index, making it
        // invisible to all scope-indexed lookups and corrupting inference.

        // Update the satellite to reflect coordinate shifts.
        sys.update(satellite, "orbital_clustering");
      }
    }
  }

  /**
   * Post a typed delta for safe deferred application inside the next tick().
   * Use this from any async context instead of writing to the manifold directly.
   */
  public postDelta(delta: Delta.Any): void {
    this.deltaQueue.post(delta);
  }

  private applyDelta(delta: Delta.Any): void {
    switch (delta.kind) {
      case "ingest": {
        if (!this.unfolder) break;
        const newIds = this.unfolder.ingestContent(
          delta.text,
          this.activeSystem
        );
        const jitter = DOPAT_CONFIG.structural.DREAM_POS_X_JITTER;
        for (let k = 0; k < newIds.length; k++) {
          const id = newIds[k];
          if (!this.activeSystem.isAllocated(id)) continue;
          this.activeSystem.decayRate[id] = 0.05;
          if (delta.basePosX !== 0 || delta.basePosY !== 0) {
            const j = (Math.random() - 0.5) * jitter;
            this.activeSystem.posX[id] = delta.basePosX + j;
            this.activeSystem.posY[id] += delta.basePosY;
            this.activeSystem.posZ[id] += delta.factDisplacementZ;
            this.activeSystem.update(id);
          }
        }
        break;
      }
      case "update": {
        switch (delta.field) {
          case "mass":
            this.activeSystem.mass[delta.id] = delta.value;
            break;
          case "posX":
            this.activeSystem.posX[delta.id] = delta.value;
            break;
          case "posY":
            this.activeSystem.posY[delta.id] = delta.value;
            break;
          case "posZ":
            this.activeSystem.posZ[delta.id] = delta.value;
            break;
          case "posW":
            this.activeSystem.posW[delta.id] = delta.value;
            break;
          case "decayRate":
            this.activeSystem.decayRate[delta.id] = delta.value;
            break;
          case "depth":
            this.activeSystem.depth[delta.id] = delta.value;
            break;
          case "time":
            this.activeSystem.time[delta.id] = delta.value;
            break;
        }
        this.activeSystem.update(delta.id);
        break;
      }
      case "free": {
        this.activeSystem.freeLocation(delta.id, "delta_queue");
        break;
      }
    }
  }

  /**
   * advances the temporal state of the manifold.
   *
   * Applies temporal decay to all logic atoms and triggers regulatory
   * routines like threat monitoring and self-healing.
   *
   * @param dt - The time delta (step size).
   */
  public tick(dt: number): void {
    // Skip calculations if manifold is currently hydrating to prevent race conditions
    if (this.isHydrating) return;

    metrics.onTick();
    metrics.gauge("system.length", this.activeSystem.length);
    metrics.gauge("system.free_list_size", this.activeAllocator.length);
    metrics.gauge("delta_queue.length", this.deltaQueue.length);

    // Drain the typed delta queue - the sole write path from all async producers.
    for (const delta of this.deltaQueue.drain()) {
      this.applyDelta(delta);
    }

    // Apply temporal decay across the manifold
    this.activeSystem.decay(dt);

    // Consolidate similar patterns
    this.consolidationRoutine(dt);

    // Phase 4: Queue the next dream cycle asynchronously.
    // Safe because dreamCycle only writes to pendingDreams, never to activeSystem directly.
    this.dreamCycle().catch(err => {
      console.error("[ManifoldLifecycle] Error during dream cycle:", err);
    });

    // Scan for destabilizing anomalies
    this.monitorThreats().catch(err => {
      console.error(
        "[ManifoldLifecycle] Error monitoring threats during tick:",
        err
      );
    });

    // Trigger background self-healing
    this.selfHealRoutine().catch(err => {
      console.error("[ManifoldLifecycle] Error during self-healing tick:", err);
    });
  }

  /**
   * Awaits all pending background stabilization tasks (hydration, self-healing).
   */
  public async waitForStability(): Promise<void> {
    if (this.stabilityPromise) {
      await this.stabilityPromise;
    }
  }

  /**
   * Records a change in the manifold's state for deterministic replay.
   *
   * This allows the system to reconstruct the drone's "thought process"
   * by logging every shift in physical logical properties.
   *
   * @param preceptId - The ID of the logic atom that changed.
   * @param field - The specific physical field (mass, scope, etc.) that was updated.
   * @param oldValue - The value before the shift.
   * @param newValue - The value after the shift.
   */
  public async logDelta(
    preceptId: number,
    field: TargetBuffer,
    oldValue: number,
    newValue: number
  ): Promise<void> {
    await this.persistence.logDelta(preceptId, field, oldValue, newValue);
  }
}
