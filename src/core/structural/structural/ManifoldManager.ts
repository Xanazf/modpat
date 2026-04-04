import type System from "@core_i/System";
import type { TargetBuffer } from "@core_i/System";
import type { SystemPersistence } from "./Persistence";
import SpectralAtomizer from "@atomics/SpectralAtomizer";

/**
 * The ManifoldManager acts as the guardian and regulator of the logical manifolds.
 *
 * It manages both the primary and emergency systems, ensuring universal
 * integrity through self-healing routines, Triple Modular Redundancy (TMR),
 * and continuous monitoring for high-mass "threats" that could destabilize
 * the logical topology.
 */
export class ManifoldManager {
  /** The primary logical universe. */
  public primarySystem: System;
  /** A parallel backup universe, used when the primary system encounters a critical anomaly. */
  public emergencySystem: System;
  /** Persistence layer for snapshotting and hydrating the manifold. */
  private persistence: SystemPersistence;
  /** The spectral atomizer for quantum processing. */
  private atomizer: SpectralAtomizer;
  /** The currently active logical universe. */
  private activeSystem: System;

  /** Triple Modular Redundancy (TMR) buffers for critical logical pointers. */
  private tmrFreeListA: number[] = [];
  private tmrFreeListB: number[] = [];
  private tmrFreeListC: number[] = [];

  /** Flag to prevent race conditions during asynchronous self-healing hydration. */
  private isHydrating: boolean = false;
  /** Promise tracking the current hydration process. */
  private stabilityPromise: Promise<void> | null = null;

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
    this.atomizer = new SpectralAtomizer();
  }

  /**
   * Retrieves the currently active logical manifold.
   */
  public getActiveSystem(): System {
    return this.activeSystem;
  }

  /**
   * Deep equality check for TMR buffers.
   */
  private arraysEqual(a: number[], b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Triple Modular Redundancy (TMR) Voter for the FreeList.
   *
   * Ensures the integrity of critical memory pointers by comparing three
   * independent buffers. Identifies consensus through majority vote.
   *
   * @returns A safe clone of the most reliable version of the FreeList.
   */
  public getVotedFreeList(): number[] {
    const ab = this.arraysEqual(this.tmrFreeListA, this.tmrFreeListB);
    const bc = this.arraysEqual(this.tmrFreeListB, this.tmrFreeListC);
    const ac = this.arraysEqual(this.tmrFreeListA, this.tmrFreeListC);

    if (ab) return [...this.tmrFreeListA];
    if (bc) return [...this.tmrFreeListB];
    if (ac) return [...this.tmrFreeListA];

    // Total disagreement: trigger interrupt and return empty list to prevent corruption
    this.triggerInterrupt("TMR Failure: Complete loss of FreeList consensus");
    return [];
  }

  /**
   * Adds a logic atom ID to the redundant FreeList buffers.
   * @param id - The ID of the decommissioned logic atom.
   */
  public pushToFreeList(id: number): void {
    this.tmrFreeListA.push(id);
    this.tmrFreeListB.push(id);
    this.tmrFreeListC.push(id);
  }

  /**
   * Reclaims a logic atom ID from the voted FreeList and synchronizes all buffers.
   * @returns A reclaimed ID, or undefined if the FreeList is empty.
   */
  public popFromFreeList(): number | undefined {
    const list = this.getVotedFreeList();
    if (list.length === 0) return undefined;
    const id = list.pop();

    // Sync all redundant lists to the new stable state
    this.tmrFreeListA = [...list];
    this.tmrFreeListB = [...list];
    this.tmrFreeListC = [...list];

    return id;
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
        `[ManifoldManager] Detected ${corruptedIds.length} corrupted precepts. Initiating self-healing...`
      );
      this.isHydrating = true;
      this.stabilityPromise = this.activeSystem
        .hydrate(this.persistence)
        .then(() => {
          console.log(`[ManifoldManager] Self-healing complete.`);
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
      `[ManifoldManager] CRITICAL INTERRUPT: ${reason}. Switching to Emergency Manifold!`
    );
    this.activeSystem = this.emergencySystem;

    // Attempt to hydrate emergency system from persistence to prevent operating on stale/empty state
    if (this.isHydrating) return this.stabilityPromise || Promise.resolve();

    this.isHydrating = true;
    this.stabilityPromise = this.activeSystem
      .hydrate(this.persistence)
      .then(() => {
        console.log(
          `[ManifoldManager] Emergency Manifold hydrated successfully.`
        );
      })
      .catch(err => {
        console.error(
          `[ManifoldManager] Failed to hydrate Emergency Manifold:`,
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
    for (let i = 0; i < sys.length; i++) {
      // Very high mass + high decay rate = anomaly/threat
      if (
        Math.abs(sys.mass[i]) > sys.c ** 2 * 1000.0 &&
        sys.decayRate[i] > 50.0
      ) {
        await this.triggerInterrupt("High-mass anomaly detected");
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

    // Apply temporal decay across the manifold
    this.activeSystem.decay(dt);

    // Scan for destabilizing anomalies
    this.monitorThreats().catch(err => {
      console.error(
        "[ManifoldManager] Error monitoring threats during tick:",
        err
      );
    });

    // Trigger background self-healing
    this.selfHealRoutine().catch(err => {
      console.error("[ManifoldManager] Error during self-healing tick:", err);
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
