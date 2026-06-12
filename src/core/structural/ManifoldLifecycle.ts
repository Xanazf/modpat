import { TMRFreeList } from "@_lib/checksum/TMRFreeList";
import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import { DOPAT_CONFIG } from "@config";
import type { TargetBuffer } from "@core_i/System";
import System, { OperatorClass, SystemRef } from "@core_i/System";
import { metrics } from "@core_s/Metrics";
import { DeltaQueue } from "@mutate/DeltaQueue";
import { buildFrameworkIndex } from "@mutate/FrameworkIndex";
import type Unfolder from "@mutate/Unfolder";
import { computeCurvature } from "@props/Curvature";
import { detectSingularities } from "@props/Singularity";
import type { InquiryQueue } from "@skill_cogi/InquiryQueue";
import { random } from "@utils/seededRandom";
import type { SystemPersistence } from "./Persistence";
import {
  buildNerveGraph,
  type NerveGraph,
  type PersistenceBar,
} from "./TopologyMapper";

/**
 * D4 – Snapshot of the manifold's topological state at one topology tick.
 * Used to identify cobordant episodes (structurally similar manifold phases)
 * for long-term memory consolidation.
 */
export interface CobordismRecord {
  /** Monotonically increasing topology-tick index. */
  tickIndex: number;
  /** Number of essential H₀ components (death = ∞). */
  h0ComponentCount: number;
  /** Total number of H₁ bars (including infinite). */
  h1BarCount: number;
  /** Sum of finite H₁ bar lifetimes (death − birth). */
  totalH1Persistence: number;
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
  readonly primaryAllocator = new TMRFreeList(name => metrics.increment(name));
  private readonly emergencyAllocator = new TMRFreeList(name =>
    metrics.increment(name)
  );
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

  // -- B3: Topology tick ------------------------------------------------------
  /** How often (in ticks) to run the full topology analysis. Budget-capped. */
  private static readonly TOPO_TICK_INTERVAL = 100;
  private _topoTick = 0;
  /** Guard preventing concurrent topology analyses (like isDreaming for dreamCycle). */
  private _isTopoRunning = false;
  /** Latest TDA Mapper nerve graph, refreshed every TOPO_TICK_INTERVAL ticks. */
  private _nerveGraph: NerveGraph | null = null;
  /** H₁ bars from the last topology snapshot, used to prioritise dreamCycle. */
  private _h1Bars: PersistenceBar[] = [];
  /** H₀ bars (all filtration levels) from the last topology snapshot. */
  private _prevH0: PersistenceBar[] = [];
  /** Atom IDs in persistent H₁ bars → preferred expansion targets. */
  private _dreamPriorityAtoms: Set<number> = new Set();
  /** InquiryQueue for routing component_birth curiosity events. */
  private _inquiryQueue: InquiryQueue | null = null;
  /** E0 – Three-tier framework index, rebuilt on each topology tick. */
  private _frameworkIndex: Mutation.FrameworkIndex | null = null;

  // -- C3: Ricci flow tick ----------------------------------------------------
  private _ricciTick = 0;

  // -- D1: Singularity tick ---------------------------------------------------
  private _singularityTick = 0;

  // -- D4: Cobordism history --------------------------------------------------
  private _cobordismHistory: CobordismRecord[] = [];
  private _globalTickIndex = 0;
  private static readonly COBORDISM_HISTORY_SIZE = 10;

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
      const newAllocator = new TMRFreeList(name => metrics.increment(name));
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
        .then(async () => {
          console.log(`[ManifoldLifecycle] Self-healing complete.`);
          this.activeSystem = newSystem;
          this.activeAllocator = newAllocator;
          this.systemRef.swap(newSystem);
          await this.loadHistoryFromPersistence();
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
      .then(async () => {
        console.log(
          `[ManifoldLifecycle] Emergency Manifold hydrated successfully.`
        );
        this.activeSystem = targetSystem;
        this.activeAllocator = targetAllocator;
        // Atomically redirect all SystemRef holders to the emergency system.
        this.systemRef.swap(targetSystem);
        await this.loadHistoryFromPersistence();
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

  /** Wire an InquiryQueue so component_birth topology events spawn curiosity entries. */
  public setInquiryQueue(queue: InquiryQueue): void {
    this._inquiryQueue = queue;
  }

  /** Latest TDA Mapper nerve graph, or null before the first topology tick. */
  public getNerveGraph(): NerveGraph | null {
    return this._nerveGraph;
  }

  /** E0 – Three-tier framework index, or null before the first topology tick. */
  public getFrameworkIndex(): Mutation.FrameworkIndex | null {
    return this._frameworkIndex;
  }

  /**
   * Forces an immediate topology rebuild (nerve graph + three-tier framework
   * index) so that newly ingested atoms are reflected in the FrameworkIndex
   * before the next normal tick fires.
   *
   * Call this after bulk atom additions (e.g. after each Unfolder expansion in
   * the compound pre-pass) so the Store's framework-scope check can see the
   * emerging domain clusters straight away.
   *
   * @param _atomIds  Reserved for future focused-consolidation optimisation;
   *                  currently unused - a full rebuild is always performed.
   */
  public consolidateAround(_atomIds: number[] = []): void {
    if (this._isTopoRunning) return;
    this._isTopoRunning = true;
    try {
      this._runTopologyTickBody();
    } finally {
      this._isTopoRunning = false;
    }
  }

  /**
   * Low-frequency topology tick: persistent homology + TDA Mapper.
   * Runs asynchronously (fire-and-forget) so it never blocks the tick loop.
   * A running guard prevents concurrent analyses.
   * Routes events to three consumers:
   *   1. _dreamPriorityAtoms  – high-persistence H₁ atoms for dreamCycle
   *   2. Vault tagging         – nerve graph exposed via getNerveGraph()
   *   3. InquiryQueue          – component_birth events with high persistence
   */
  private async runTopologyTick(): Promise<void> {
    if (this._isTopoRunning) return;
    this._isTopoRunning = true;
    try {
      this._runTopologyTickBody();
    } finally {
      this._isTopoRunning = false;
    }
  }

  private _runTopologyTickBody(): void {
    const sys = this.activeSystem;
    const prevH1 = this._h1Bars;

    try {
      this._nerveGraph = buildNerveGraph(sys, {
        topK: 200,
        maxRadius: DOPAT_CONFIG.orbital.BASE_RADIUS,
      });
    } catch {
      return;
    }

    const { h0, h1 } = this._nerveGraph.diagram;

    // -- E0: rebuild three-tier framework index ----------------------------
    try {
      this._frameworkIndex = buildFrameworkIndex(sys, this._nerveGraph);
    } catch {
      // Non-critical: leave last known index in place on failure.
    }

    // -- dream prioritisation ----------------------------------------------
    const MIN_PERSISTENCE = DOPAT_CONFIG.orbital.BASE_RADIUS * 0.1;
    this._dreamPriorityAtoms = new Set(
      h1
        .filter(bar => bar.death - bar.birth > MIN_PERSISTENCE)
        .map(bar => bar.generatorAtomId)
    );
    this._h1Bars = h1;

    // -- emit TopologyEvents -----------------------------------------------
    const prevH1Atoms = new Set(prevH1.map(b => b.generatorAtomId));
    const newH1Atoms = new Set(h1.map(b => b.generatorAtomId));

    // Component births/deaths track changes in the set of *essential* components
    // (bars with death=Infinity, i.e. connected components that persist to the
    // maximum filtration radius).  Finite-death bars are historical merge events
    // that exist at every snapshot - comparing them between ticks is meaningless.
    const prevH0InfiniteAtoms = new Set(
      this._prevH0.filter(b => b.death === Infinity).map(b => b.generatorAtomId)
    );
    const currH0InfiniteAtoms = new Set(
      h0.filter(b => b.death === Infinity).map(b => b.generatorAtomId)
    );
    this._prevH0 = h0;

    const events: Topology.Event[] = [];

    for (const atomId of currH0InfiniteAtoms) {
      if (!prevH0InfiniteAtoms.has(atomId)) {
        events.push({
          type: "component_birth",
          persistence: Infinity,
          atomId,
        });
      }
    }
    for (const atomId of prevH0InfiniteAtoms) {
      if (!currH0InfiniteAtoms.has(atomId)) {
        events.push({
          type: "component_death",
          persistence: Infinity,
          atomId,
        });
      }
    }

    for (const bar of h1) {
      if (!prevH1Atoms.has(bar.generatorAtomId)) {
        events.push({
          type: "loop_appeared",
          persistence: bar.death - bar.birth,
          atomId: bar.generatorAtomId,
        });
      }
    }
    for (const bar of prevH1) {
      if (!newH1Atoms.has(bar.generatorAtomId) && bar.death !== Infinity) {
        events.push({
          type: "loop_collapsed",
          persistence: bar.death - bar.birth,
          atomId: bar.generatorAtomId,
        });
      }
    }

    // -- route to InquiryQueue ---------------------------------------------
    if (this._inquiryQueue) {
      for (const ev of events) {
        if (ev.type === "component_birth" && ev.persistence > MIN_PERSISTENCE) {
          const scope = sys.scope[ev.atomId];
          const label = (this.unfolder as any)?.resolveScope(scope) as
            | string
            | undefined;
          if (label && label.length > 2) {
            this._inquiryQueue.enqueue(
              label,
              `topology:component_birth:${ev.atomId}`
            );
          }
        }
      }
    }

    if (events.length > 0) {
      metrics.increment("topology.events", events.length);
    }

    // -- D4: Record cobordism snapshot -----------------------------------------
    const totalH1Persistence = h1
      .filter(b => b.death !== Infinity)
      .reduce((sum, b) => sum + (b.death - b.birth), 0);
    const record: CobordismRecord = {
      tickIndex: this._globalTickIndex++,
      h0ComponentCount: h0.filter(b => b.death === Infinity).length,
      h1BarCount: h1.length,
      totalH1Persistence,
    };
    this._cobordismHistory.push(record);
    if (
      this._cobordismHistory.length > ManifoldLifecycle.COBORDISM_HISTORY_SIZE
    ) {
      this._cobordismHistory.shift();
    }
    this.persistence.saveCobordismRecord(record).catch(err => {
      console.error(
        `[ManifoldLifecycle] Failed to persist cobordism record:`,
        err
      );
    });
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
   * C3 - Discrete Ricci flow maintenance tick.
   *
   * Applies φ̇ = −R to the manifold by nudging each atom's density proportional
   * to −clamp(R_i, ±RICCI_BLOWUP_THRESHOLD).  Runs synchronously (the curvature
   * computation is O(n · neighbours)), guarded by the Ricci tick counter.
   *
   * "Clamp the input R, not the result" per ROADMAP: the raw curvature value is
   * clamped before the density update so a single pathological atom cannot
   * produce an unbounded density spike.
   */
  private runRicciFlowTick(): void {
    const sys = this.activeSystem;
    const phys = DOPAT_CONFIG.PHYSICS;
    const thresh = phys.RICCI_BLOWUP_THRESHOLD;
    const lr = phys.RICCI_LR;
    const actualRadius = Math.sqrt(phys.INFLUENCE_RADIUS);

    // Build a lightweight grid for the curvature neighbourhood queries.
    const grid = new GridIndex4D(Math.max(actualRadius, 0.5));
    grid.buildFromSystem(sys);

    let updated = 0;
    for (let i = 0; i < sys.length; i++) {
      if (!sys.isAllocated(i)) continue;
      const { R } = computeCurvature(
        sys,
        grid,
        sys.posX[i],
        sys.posY[i],
        sys.posZ[i],
        sys.posW[i]
      );
      // Clamp R before using it - prevents runaway updates in dense/pathological regions.
      const R_clamped = Math.max(-thresh, Math.min(thresh, R));
      if (R_clamped === 0) continue;
      const delta = -lr * R_clamped;
      sys.density[i] = Math.max(0, sys.density[i] + delta);
      sys.mass[i] += delta;
      sys.update(i);
      updated++;
    }

    if (updated > 0) metrics.increment("ricci.atoms_updated", updated);
  }

  /**
   * D1 – Singularity detection and remediation tick.
   *
   * Scans for atoms where |∇φ|² / (1 + φ²) > SINGULARITY_THRESHOLD and splits
   * each one into two atoms placed on opposite sides of a random orthogonal axis.
   * Capped at 10 remediations per tick to prevent population bursts.
   */
  private runSingularityTick(): void {
    const sys = this.activeSystem;
    const phys = DOPAT_CONFIG.PHYSICS;
    const actualRadius = Math.sqrt(phys.INFLUENCE_RADIUS);
    const splitR = phys.SINGULARITY_SPLIT_RADIUS;

    const grid = new GridIndex4D(Math.max(actualRadius, 0.5));
    grid.buildFromSystem(sys);

    const candidates = detectSingularities(sys, grid);
    if (candidates.length === 0) return;

    metrics.increment("singularity.detected", candidates.length);

    const MAX_REMEDIATIONS = 10;
    let remediated = 0;

    for (const { atomId } of candidates) {
      if (remediated >= MAX_REMEDIATIONS) break;

      let newId: number;
      try {
        newId = sys.createLocation(
          sys.mass[atomId] * 0.5,
          sys.scope[atomId],
          "singularity_split"
        );
      } catch {
        break; // manifold at capacity
      }
      sys.mass[atomId] *= 0.5;

      // Copy non-mass fields to the sibling.
      sys.density[newId] = sys.density[atomId];
      sys.intensity[newId] = sys.intensity[atomId];
      sys.entropyRate[newId] = sys.entropyRate[atomId];
      sys.decayRate[newId] = sys.decayRate[atomId];
      sys.operatorClass[newId] = sys.operatorClass[atomId];
      sys.depth[newId] = sys.depth[atomId];
      sys.slotType[newId] = sys.slotType[atomId];
      sys.time[newId] = sys.time[atomId];

      // Displace along a random direction in the XY plane; nudge W (temporal) too.
      const theta = random() * Math.PI * 2;
      sys.posX[newId] = sys.posX[atomId] + splitR * Math.cos(theta) * 0.3;
      sys.posY[newId] = sys.posY[atomId] + splitR * Math.sin(theta) * 0.3;
      sys.posZ[newId] = sys.posZ[atomId];
      sys.posW[newId] = sys.posW[atomId] + splitR * 0.5;

      // Nudge the original atom in the opposite half-direction.
      sys.posX[atomId] -= splitR * Math.cos(theta) * 0.15;
      sys.posY[atomId] -= splitR * Math.sin(theta) * 0.15;
      sys.posW[atomId] -= splitR * 0.25;

      sys.update(atomId);
      sys.update(newId);
      remediated++;
    }

    if (remediated > 0) metrics.increment("singularity.remediated", remediated);
  }

  /**
   * D4 – Returns past episodes whose topology is cobordant to the given tick.
   *
   * Two episodes are cobordant if they have the same number of H₀ components
   * (±1) and similar total H₁ persistence (within 20%).  Cobordant episodes
   * share consolidated manifold representations and are candidates for
   * long-term memory consolidation.
   */
  public getCobordantEpisodes(tickIndex: number): CobordismRecord[] {
    const target = this._cobordismHistory.find(r => r.tickIndex === tickIndex);
    if (!target) return [];
    return this._cobordismHistory.filter(r => {
      if (r.tickIndex === tickIndex) return false;
      const h0Match =
        Math.abs(r.h0ComponentCount - target.h0ComponentCount) <= 1;
      const h1Match =
        target.totalH1Persistence < 1e-9
          ? r.totalH1Persistence < 1e-9
          : Math.abs(r.totalH1Persistence - target.totalH1Persistence) /
              target.totalH1Persistence <
            0.2;
      return h0Match && h1Match;
    });
  }

  /** D4 - All recorded cobordism snapshots, most recent first. */
  public getCobordismHistory(): CobordismRecord[] {
    return [...this._cobordismHistory].reverse();
  }

  /** Hydrates cobordism history from the persistent database. */
  public async loadHistoryFromPersistence(): Promise<void> {
    const history = await this.persistence.loadCobordismHistory();
    this._cobordismHistory = history;
    if (history.length > 0) {
      let maxTick = -1;
      for (const r of history) {
        if (r.tickIndex > maxTick) {
          maxTick = r.tickIndex;
        }
      }
      this._globalTickIndex = maxTick + 1;
    }
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

      // C2: Build a grid and rank candidates by absolute scalar curvature |R|.
      // High-curvature zones are under-resolved - expansion effort goes there first.
      // Falls back to topology-priority + linear scan when fewer than 10 atoms exist.
      const actualRadius = Math.sqrt(DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS);
      const curvGrid = new GridIndex4D(Math.max(actualRadius, 0.5));
      curvGrid.buildFromSystem(sys);
      const ranked = this.unfolder.rankExpansionCandidates(curvGrid, 500);
      const scanOrder: number[] = ranked.map(c => c.id);

      // Append any topology-priority atoms not already in the ranked set (covers low-population manifolds).
      const rankedSet = new Set(scanOrder);
      for (const id of this._dreamPriorityAtoms) {
        if (
          id >= 0 &&
          id < sys.length &&
          sys.isAllocated(id) &&
          !rankedSet.has(id)
        ) {
          scanOrder.push(id);
        }
      }

      for (const i of scanOrder) {
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
            const j = (random() - 0.5) * jitter;
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

    // B3: Low-frequency topology tick (every TOPO_TICK_INTERVAL ticks).
    // Fire-and-forget: the running guard inside prevents overlap.
    if (++this._topoTick >= ManifoldLifecycle.TOPO_TICK_INTERVAL) {
      this._topoTick = 0;
      this.runTopologyTick().catch(err => {
        console.error("[ManifoldLifecycle] Error during topology tick:", err);
      });
    }

    // C3: Discrete Ricci flow maintenance (every RICCI_TICK_INTERVAL ticks).
    if (++this._ricciTick >= DOPAT_CONFIG.PHYSICS.RICCI_TICK_INTERVAL) {
      this._ricciTick = 0;
      try {
        this.runRicciFlowTick();
      } catch (err) {
        console.error("[ManifoldLifecycle] Error during Ricci flow tick:", err);
      }
    }

    // D1: Singularity detection and remediation (every SINGULARITY_TICK_INTERVAL ticks).
    if (
      ++this._singularityTick >= DOPAT_CONFIG.PHYSICS.SINGULARITY_TICK_INTERVAL
    ) {
      this._singularityTick = 0;
      try {
        this.runSingularityTick();
      } catch (err) {
        console.error(
          "[ManifoldLifecycle] Error during singularity tick:",
          err
        );
      }
    }

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
