import { createHash } from "node:crypto";
import { DOPAT_CONFIG } from "@config";
import type { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";
import { gpu_math, multiplyMatrices4x4 } from "@core_s/Math";
import type Store from "@core_s/Memory";
import { metrics } from "@core_s/Metrics";
import type {
  FrameworkId,
  Matrix4x4,
  TravelerState,
} from "@mutate/FrameworkIndex";
import type QueryDecomposer from "@mutate/QueryDecomposer";
import type { SubQuery } from "@mutate/QueryDecomposer";
import type Unfolder from "@mutate/Unfolder";
import { type InquiryItem, InquiryQueue } from "@skill_cogi/InquiryQueue";
import {
  getMetricForceWithInnerDerivative as _locoGetMetricForceWithInnerDerivative,
  buildGridIndex,
  computeHolonomy,
  detectHomotopy,
  getMetricForce,
  type LocomotionState,
  makeLocomotionState,
  regularizeChristoffels,
  reinforcePath,
  travel,
} from "@skill_cogi/Locomotion";
import {
  makePerceptionCache,
  type PerceptionCache,
  type PerceptionDeps,
  perceiveCapturing as perceptionCapturing,
  perceiveCoherent as perceptionCoherent,
  collectSequence as perceptionCollect,
  observeSettlingGradient as perceptionOSG,
  perceive as perceptionPerceive,
  settleAtoms,
} from "@skill_cogi/Perception";
import type { Language } from "@skill_lang/Language";
import type { WorkingMemory } from "@skill_lang/WorkingMemory";
import {
  boostIntent,
  decayIntent,
  IntentTag,
  spawnIntent as spawnIntentPrecept,
} from "@utils/intentPrecept";
import logger from "@utils/SpectralLogger";
import { extractTopic } from "@utils/topicExtraction";
import nlp from "compromise";
import { resolveLogicFormula } from "./formula/E1Formula";
import { classifyOperatorToken, OperatorClass, SystemRef } from "./System";
import type { SkillHandler } from "./skills";

// Canonical definitions live in src/_types/Integral.d.ts (Mapping namespace).
// These re-exports preserve existing import paths for downstream code.
export type PerceptionOptions = Mapping.PerceptionOptions;
export type ResolveOptions = Mapping.PerceptionOptions;
export type CoherentResult = Mapping.CoherentResult;
export type BridgeCandidate = Mapping.BridgeCandidate;
export type DiscoveredOperator = Mapping.DiscoveredOperator;
export type PerceptionDiagnostics = Mapping.PerceptionDiagnostics;
export type PerceptionCapture = Mapping.PerceptionCapture;
export type HomotopyResult = Mapping.HomotopyResult;

/**
 * The Mapper is THE thinker. It owns perception (resonance propagation
 * through the manifold) AND locomotion (geodesic traversal). Thinking IS
 * movement through the world; there is no separate deliberation step.
 *
 * Locomotion (was Mapper):
 *  - `traverse` (was `route`) - gradient-descent geodesic through the 4D
 *    potential field. `calculateGeodesic` is kept as an alias for back-compat.
 *
 * Perception (was Resolver):
 *  - `perceive` (was `resolveSequence`) - full Phase 0..7 pipeline.
 *  - `perceiveCapturing` - race-free diagnostics capture.
 *  - `perceiveCoherent` - iterative coherence loop.
 *  - `probe` - topology-only perception, no vault.
 */
class Traveler implements Mapping.Engine {
  /** Shared reference cell, swap fires on ManifoldLifecycle failover. */
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  /** The engine for transforming between text and quanta. */
  private atomizer: Atomic.Engine;
  /** Persistent storage for logical proofs. */
  private store: Store | null = null;
  /** Optional GPU math engine for acceleration. */
  private gpu: PMath.Engine | null = null;
  /** Optional Fractal Unfolder for expanding logical voids. */
  private unfolder: Unfolder | null = null;
  /** Optional decomposer for compound query prerequisite resolution. */
  private _decomposer: QueryDecomposer | null = null;
  /** The language translation boundary. */
  public language: Language | null = null;
  /** Optional structural manifold lifecycle for framework indexing. */
  public lifecycle: ManifoldLifecycle | null = null;
  /** Open-ended skill registry. */
  private skills = new Map<number, SkillHandler>();
  /** Last-elected skill ID for feedback loop. */
  private lastSkillElected = 0;
  /** Last-abstracted signature for feedback loop. */
  public lastSignature: string | null = null;

  /** Maximum input length enforced by perceive(). */
  private static readonly MAX_SEQUENCE_LENGTH = 1024;

  // Locomotion and perception state – plain objects, no class instances.
  private readonly _loco: LocomotionState = makeLocomotionState();
  private readonly _perc: PerceptionCache = makePerceptionCache();

  /** Sink strength from the most recent inference call. */
  public lastSinkStrength = 0;
  /** Always null in the gradient pipeline; kept for API compat. */
  public lastDiagnostics: PerceptionDiagnostics | null = null;
  /** P2 clamp counter (proxied from _loco). */
  public get phiClippedCount(): number {
    return this._loco.phiClippedCount;
  }
  public set phiClippedCount(v: number) {
    this._loco.phiClippedCount = v;
  }

  /** D2: holonomy matrix from the most recent traversal. */
  public get lastHolonomy(): Float64Array {
    return this._loco.lastHolonomy;
  }
  /** D2: inferential effort scalar. */
  public get lastInferentialEffort(): number {
    return this._loco.lastInferentialEffort;
  }

  // -- C4: Learned Christoffel corrections ------------------------------------
  /**
   * ΔΓᵢⱼᵏ: learned correction tensor (4×4×4 = 64 floats, indexed [i*16+j*4+k]).
   * Applied as an additional geodesic deviation force during relaxPath.
   * Initialised to zero; the prescribed conformal metric dominates until
   * sufficient vault-hit / trap training signal accrues.
   */
  /** C4 learned Christoffel corrections (lives in _loco). */
  public get deltaGamma(): Float64Array {
    return this._loco.deltaGamma;
  }
  /** Mean unit-velocity direction of the most recently relaxed path (used for training). */
  private _lastPathVelocity: [number, number, number, number] = [0, 0, 0, 0];

  // -- TRAVELER step 2: Persistent geometric working memory ------------------

  /** Current 4D position in the manifold. Starts at the pole (0,0,0,0); drifts with each interaction. */
  public position: [number, number, number, number] = [0, 0, 0, 0];

  /**
   * Accumulated session holonomy (4×4 row-major Float64Array).
   * Product of all lastHolonomy matrices across traversals this session.
   * Periodically re-orthogonalized via Gram-Schmidt to prevent SO(4) drift.
   */
  public readonly holonomyFrame = new Float64Array(16) as Matrix4x4;

  /** Active frameworks from E0 FrameworkIndex (populated in step 5). */
  public readonly activeFrameworks = new Set<FrameworkId>();

  /** Total inferential effort accumulated this session (sum of lastInferentialEffort). */
  public sessionEffort = 0;

  /** Tracks traversal count for Gram-Schmidt re-orthogonalization cadence. */
  private _traversalCount = 0;

  /**

  /**
   * Initializes the Mapper with a reference to the dual-layer manifold.
   *
   * @param system The logical manifold (or a SystemRef wrapping it).
   * @param atomizer The quantum transformer (optional - if omitted, perception
   *                 methods that need decoding will throw; callers that only
   *                 need locomotion can pass null/undefined).
   * @param store Optional persistent memory vault.
   * @param gpu Optional GPU math engine.
   * @param unfolder Optional Unfolder for void expansion.
   */
  constructor(
    system: Root.ManifoldView | SystemRef,
    atomizer?: Atomic.Engine,
    store: Store | null = null,
    gpu: PMath.Engine | null = null,
    unfolder: Unfolder | null = null
  ) {
    this.systemRef =
      system instanceof SystemRef ? system : new SystemRef(system);
    // atomizer/store may be unset when the Mapper is used purely for
    // locomotion. Cast through `any` here so the type stays non-null for
    // perception code paths while still allowing the legacy single-arg form
    // (Mapper(system)) used internally by older tests.
    this.atomizer = atomizer as any;
    this.store = store;
    this.gpu = gpu;
    this.unfolder = unfolder;

    // TRAVELER step 2: seed accumulated session holonomy as identity.
    this.holonomyFrame[0] =
      this.holonomyFrame[5] =
      this.holonomyFrame[10] =
      this.holonomyFrame[15] =
        1;

    // Initialize GPU offloading if configured.
    if (DOPAT_CONFIG.USE_GPU && !this.gpu) {
      gpu_math.getDevice()
        .then(() => {
          this.gpu = gpu_math;
          this._loco.gpu = gpu_math;
        })
        .catch(e => {
          console.warn("GPU init failed, using CPU:", e.message);
        });
    }
  }

  // -------------------------------------------------------------------------
  // GPU / Unfolder wiring
  // -------------------------------------------------------------------------

  public setGPU(gpu: PMath.Engine | null): void {
    this.gpu = gpu;
    this._loco.gpu = gpu;
    this._loco.geodesicPipeline = null; // force re-creation with updated shader
  }

  /** Backward-compat alias. */
  public setGPUEnabled(enabled: boolean): void {
    if (enabled) {
      if (!this.gpu) {
        gpu_math.getDevice().then(() => {
          this.gpu = gpu_math;
          this._loco.gpu = gpu_math;
        });
      }
    } else {
      this.gpu = null;
      this._loco.gpu = null;
      this._loco.geodesicPipeline = null;
    }
  }

  public setUnfolder(unfolder: Unfolder | null): void {
    this.unfolder = unfolder;
  }

  public setDecomposer(decomposer: QueryDecomposer | null): void {
    this._decomposer = decomposer;
  }

  public setLanguage(language: Language): void {
    this.language = language;
  }

  public setLifecycle(lifecycle: ManifoldLifecycle | null): void {
    this.lifecycle = lifecycle;
  }

  /**
   * Registers a skill handler for a specific capability precept.
   */
  public registerSkill(preceptId: number, handler: SkillHandler): void {
    this.skills.set(preceptId, handler);
  }

  /**
   * Elects the most appropriate skill for a given query sequence.
   * Finds the capability precept with the strongest gravitational attraction
   * to the query's manifold position.
   */
  public electSkill(ids: Uint32Array, intent?: string): number {
    if (this.skills.size === 0) {
      logger.log("[Mapper] No skills registered!");
      return 0;
    }
    if (ids.length === 0) return 0;

    // TODO: Implement potential field proximity calculation.
    // For Phase 4, we use a simple heuristic: if any registered skill's
    // precept ID is in the query or if we have a default.
    // In the real implementation, this will use spatialIndex lookups.

    // Phase 4: Intent-based routing
    if (intent === "code") {
      for (const id of this.skills.keys()) {
        const label = this.atomizer.resolveScope(id);
        if (label?.toLowerCase() === "skill:code") return id;
      }
    }

    if (intent === "assertion") {
      for (const id of this.skills.keys()) {
        const label = this.atomizer.resolveScope(id);
        if (label?.toLowerCase() === "skill:assertion") return id;
      }
    }

    // Default: SKILL:LANGUAGE
    for (const id of this.skills.keys()) {
      const label = this.atomizer.resolveScope(id);
      if (label?.toLowerCase() === "skill:language") return id;
    }

    return this.skills.keys().next().value ?? 0;
  }

  /**
   * Vault-hit reinforcement: boost atom masses and refresh concept ages on
   * both input and output sides of a successful cache lookup.
   */
  public reinforceVaultHit(
    inputIds: Uint32Array,
    outputIds: Uint32Array
  ): void {
    this.boostAtomMasses(inputIds);
    this.boostAtomMasses(outputIds);
  }

  private boostAtomMasses(ids: Uint32Array): void {
    const BOOST = 1.02;
    const CAP = this.system.c * 30;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (!this.system.isAllocated(id)) continue;
      const m = this.system.mass[id];
      if (m <= 0) continue;
      this.system.mass[id] = Math.min(m * BOOST, CAP);
      this.system.update(id);
    }
    this.system.refreshConceptAgeForIds(ids);
  }

  public async dispose(): Promise<void> {
    if (this.gpu) {
      await this.gpu.dispose();
      this.gpu = null;
    }
  }

  // =========================================================================
  // LOCOMOTION (was Mapper.route + helpers)
  // =========================================================================

  /**
   * Traverses the optimal geodesic path through the logic manifold.
   * Replaces the legacy `route` name; both call sites are equivalent.
   */
  public async traverse(
    sourceId: number,
    targetId: number,
    options: Mapping.RouteOptions = {}
  ): Promise<Uint32Array> {
    const result = await travel(
      sourceId,
      targetId,
      options,
      this.unfolder,
      this.system,
      this._loco
    );
    this._updateTravelerState(targetId, result);
    return result;
  }

  // Kept only for the dead-code path checker – entire body replaced above.

  /** Backward-compat alias for `traverse`. */
  public route(
    sourceId: number,
    targetId: number,
    options: Mapping.RouteOptions = {}
  ): Promise<Uint32Array> {
    return this.traverse(sourceId, targetId, options);
  }

  /**
   * Calculates a Geodesic Path in 4D (X, Y, Entropy, Time) between two concepts.
   * Kept as an alias for the previous Resolver.calculateGeodesic API.
   */
  public async calculateGeodesic(
    startId: number,
    endId: number,
    steps: number = 32,
    boostScopes?: Set<number>,
    topic?: string,
    preExpandLength: number = 0
  ): Promise<Uint32Array> {
    return this.traverse(startId, endId, {
      steps,
      boostScopes,
      topic,
      preExpandLength,
    });
  }

  // -- TRAVELER step 2: TravelerState management -----------------------------

  /** Updates position, holonomyFrame, and sessionEffort after a traverse(). */
  private _updateTravelerState(targetId: number, path: Uint32Array): void {
    if (this.system.isAllocated(targetId)) {
      this.position[0] = this.system.posX[targetId];
      this.position[1] = this.system.posY[targetId];
      this.position[2] = this.system.posZ[targetId];
      this.position[3] = this.system.posW[targetId];
    }

    // Accumulate session holonomy: holonomyFrame = lastHolonomy × holonomyFrame
    const newFrame = multiplyMatrices4x4(this.lastHolonomy, this.holonomyFrame);
    this.holonomyFrame.set(newFrame);

    this.sessionEffort += this.lastInferentialEffort;
    this._traversalCount++;

    if (this._traversalCount % 10 === 0) {
      this._gramSchmidtReorthogonalize();
    }

    // Populate active frameworks from the path history
    if (this.lifecycle) {
      const index = this.lifecycle.getFrameworkIndex();
      if (index) {
        for (let i = 0; i < path.length; i++) {
          const id = path[i];
          if (!this.system.isAllocated(id)) continue;
          for (const sc of index.superclusters) {
            if (sc.memberAtomIds.has(id)) this.activeFrameworks.add(sc.id);
          }
          for (const cl of index.clusters) {
            if (cl.memberAtomIds.has(id)) this.activeFrameworks.add(cl.id);
          }
          for (const sub of index.subclusters) {
            if (sub.memberAtomIds.has(id)) this.activeFrameworks.add(sub.id);
          }
        }
      }
    }
  }

  /** Gram-Schmidt re-orthogonalizes holonomyFrame rows to prevent SO(4) drift. */
  private _gramSchmidtReorthogonalize(): void {
    const H = this.holonomyFrame;
    for (let r = 0; r < 4; r++) {
      for (let p = 0; p < r; p++) {
        let dot = 0;
        for (let k = 0; k < 4; k++) dot += H[r * 4 + k] * H[p * 4 + k];
        for (let k = 0; k < 4; k++) H[r * 4 + k] -= dot * H[p * 4 + k];
      }
      let norm = 0;
      for (let k = 0; k < 4; k++) norm += H[r * 4 + k] * H[r * 4 + k];
      norm = Math.sqrt(norm) + 1e-12;
      for (let k = 0; k < 4; k++) H[r * 4 + k] /= norm;
    }
  }

  /**
   * Session lifecycle - Applies one step of gravitational drift toward the pole.
   * Called from _cogTick() when no active traversal is in progress.
   * Each position component decays by the POLE_IDLE_ATTRACTION factor so the
   * Traveler drifts back to (0,0,0,0) over time, making it receptive to fresh
   * input again after a period of inactivity.
   */
  private _idleDriftToPole(): void {
    const decay = 1 - DOPAT_CONFIG.PHYSICS.POLE_IDLE_ATTRACTION;
    this.position[0] *= decay;
    this.position[1] *= decay;
    this.position[2] *= decay;
    this.position[3] *= decay;
  }

  /** Delegate to the pure E1Formula module (formula/E1Formula.ts). */
  private _resolveLogicFormula(ids: Uint32Array): Uint32Array | null {
    return resolveLogicFormula(ids, this.system);
  }

  /**
   * Resets positional state to the pole without clearing learned state.
   * deltaGamma and vault are preserved; activeFrameworks is cleared because
   * a pole reset represents a full context reset - no prior traversal history
   * should influence the new session's framework scope.
   */
  public resetToPole(): void {
    this.position[0] =
      this.position[1] =
      this.position[2] =
      this.position[3] =
        0;
    this.holonomyFrame.fill(0);
    this.holonomyFrame[0] =
      this.holonomyFrame[5] =
      this.holonomyFrame[10] =
      this.holonomyFrame[15] =
        1;
    this.sessionEffort = 0;
    this.activeFrameworks.clear();
  }

  /** Applies a previously loaded or serialized TravelerState to this instance. */
  public applyState(state: TravelerState): void {
    this.position[0] = state.position[0];
    this.position[1] = state.position[1];
    this.position[2] = state.position[2];
    this.position[3] = state.position[3];
    this.holonomyFrame.set(state.holonomyFrame);
    this.activeFrameworks.clear();
    for (const f of state.activeFrameworks) this.activeFrameworks.add(f);
    this.sessionEffort = state.sessionEffort;
  }

  public async persistState(sessionId: string): Promise<void> {
    if (!this.store) return;
    await this.store.saveTravelerState(sessionId, {
      position: [
        this.position[0],
        this.position[1],
        this.position[2],
        this.position[3],
      ],
      holonomyFrame: this.holonomyFrame as Matrix4x4,
      activeFrameworks: new Set(this.activeFrameworks),
      sessionEffort: this.sessionEffort,
    });
  }

  public async loadState(sessionId: string): Promise<void> {
    if (!this.store) return;
    const state = await this.store.loadTravelerState(sessionId);
    if (state) this.applyState(state);
  }

  // =========================================================================
  // LOCOMOTION WRAPPERS  (implementations live in skills/cognition/Locomotion.ts)
  // =========================================================================

  /** Build / rebuild the locomotion spatial index. Called by traverse() and PerceptionDeps. */
  public buildGridIndex(): void {
    buildGridIndex(this.system, this._loco);
  }

  /** Conformal metric force at a point. Exposed to PerceptionDeps. */
  public getMetricForce(
    px: number,
    py: number,
    pz: number,
    pw: number,
    pens: any[],
    boost: Set<number> | undefined,
    activeAtoms?: Set<number>
  ): [V: number, fx: number, fy: number, fz: number, fw: number] {
    return getMetricForce(
      px,
      py,
      pz,
      pw,
      pens,
      boost,
      activeAtoms,
      this.system,
      this._loco
    );
  }

  /** Full-gradient variant (A/B testing flag forced on). */
  public getMetricForceWithInnerDerivative(
    px: number,
    py: number,
    pz: number,
    pw: number,
    pens: any[],
    boost: Set<number> | undefined,
    activeAtoms?: Set<number>
  ): [V: number, fx: number, fy: number, fz: number, fw: number] {
    return _locoGetMetricForceWithInnerDerivative(
      px,
      py,
      pz,
      pw,
      pens,
      boost,
      activeAtoms,
      this.system,
      this._loco
    );
  }

  public regularizeChristoffels(): void {
    regularizeChristoffels(this._loco);
  }

  // Private shims kept for test access via `(traveler as any)._settleAtoms(...)` etc.
  private _settleAtoms(
    ids: Uint32Array,
    driftTargets: Map<number, readonly [number, number, number, number]>,
    boost?: Set<number>,
    activeAtoms?: Set<number>
  ): void {
    settleAtoms(ids, driftTargets, boost, activeAtoms, this._perceptionDeps());
  }

  // Private shim kept for test access via `(traveler as any)._computeHolonomy(...)`.
  private _computeHolonomy(
    px: Float64Array,
    py: Float64Array,
    pe: Float64Array,
    pa: Float64Array,
    steps: number
  ): void {
    computeHolonomy(px, py, pe, pa, steps, this._loco);
  }

  // C4: external learning signal (called from learnCycle after challenge outcomes).
  private _updateChristoffels(scale: number): void {
    const v = this._loco._lastPathVelocity,
      lr = DOPAT_CONFIG.PHYSICS.CHRISTOFFEL_LR;
    const delta = lr * scale,
      dG = this._loco.deltaGamma;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const base = i * 16 + j * 4;
        for (let k = 0; k < 4; k++) dG[base + k] += delta * v[i] * v[j] * v[k];
      }
  }

  public detectHomotopy(
    pathA: Uint32Array,
    pathB: Uint32Array,
    h1Bars: Topology.PersistenceBar[],
    minPersistence = 0
  ): HomotopyResult {
    return detectHomotopy(pathA, pathB, h1Bars, minPersistence, this.system);
  }

  // =========================================================================
  // PERCEPTION DELEGATES  (implementations live in skills/cognition/Perception.ts)
  // =========================================================================

  public async observeSettlingGradient(
    ids: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    const r = await perceptionOSG(
      ids,
      opts,
      this._perceptionDeps(),
      this._perc
    );
    this.lastSinkStrength = r.sinkStrength;
    return r.ids;
  }
  public async perceive(
    ids: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    const r = await perceptionPerceive(
      ids,
      opts,
      this._perceptionDeps(),
      this._perc,
      Traveler.MAX_SEQUENCE_LENGTH
    );
    this.lastSinkStrength = r.sinkStrength;
    return r.ids;
  }
  public async perceiveCapturing(
    ids: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<PerceptionCapture> {
    return perceptionCapturing(
      ids,
      opts,
      this._perceptionDeps(),
      this._perc,
      Traveler.MAX_SEQUENCE_LENGTH
    );
  }
  public async perceiveCoherent(
    ids: Uint32Array,
    opts: {
      probeMode?: boolean;
      maxIterations?: number;
      contextScopes?: Set<number>;
    } = {}
  ): Promise<CoherentResult> {
    return perceptionCoherent(
      ids,
      opts,
      this._perceptionDeps(),
      this._perc,
      Traveler.MAX_SEQUENCE_LENGTH
    );
  }
  public collectSequence(startId: number, direction: 1 | -1): Uint32Array {
    return perceptionCollect(startId, direction, this.system);
  }

  /** Build the PerceptionDeps object from live Traveler state. */
  private _perceptionDeps(): PerceptionDeps {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      get system() {
        return self.systemRef.current;
      },
      get atomizer() {
        return self.atomizer;
      },
      get store() {
        return self.store;
      },
      get language() {
        return self.language;
      },
      get lifecycle() {
        return self.lifecycle;
      },
      get gridIndex() {
        return self._loco.gridIndex;
      },
      get position() {
        return self.position;
      },
      get activeFrameworks() {
        return self.activeFrameworks;
      },
      get lastInferentialEffort() {
        return self._loco.lastInferentialEffort;
      },
      buildGridIndex: () => self.buildGridIndex(),
      traverse: (src, tgt, opts) => self.traverse(src, tgt, opts),
      getMetricForce: (px, py, pz, pw, pens, boost, active) =>
        self.getMetricForce(px, py, pz, pw, pens, boost, active),
      boostAtomMasses: ids => self.boostAtomMasses(ids),
    };
  }

  // One-liner aliases (kept here as redirects per architectural convention)
  public async probe(
    ids: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    return this.perceive(ids, { ...opts, probeMode: true });
  }
  public probeSequence(
    ids: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    return this.probe(ids, opts);
  }
  public resolveSequence(
    ids: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    return this.perceive(ids, opts);
  }
  public resolveSequenceCaptured(
    ids: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<PerceptionCapture> {
    return this.perceiveCapturing(ids, opts);
  }
  public resolveCoherent(
    ids: Uint32Array,
    opts: { probeMode?: boolean; maxIterations?: number } = {}
  ): Promise<CoherentResult> {
    return this.perceiveCoherent(ids, opts);
  }

  // =========================================================================
  // SKILLS / PROCESS / LEARNING / MOTIVATION / INQUIRY (Phase 3+4)
  // =========================================================================

  // ---- Learner internals --------------------------------------------------

  private static readonly NOISE_PROBES = [
    "mathematics",
    "ocean",
    "atmosphere",
    "civilization",
    "architecture",
    "astronomy",
    "chemistry",
    "philosophy",
    "electricity",
    "geography",
    "evolution",
    "mythology",
  ];

  private _contextFingerprint(): string {
    const n = this.system.length;
    const sample = Array.from(this.system.scope.subarray(0, Math.min(100, n)));
    return createHash("sha256")
      .update(`${n}:${sample.join(",")}`)
      .digest("hex")
      .slice(0, 16);
  }

  private _buildProbeText(factText: string): string | null {
    const tokens = factText
      .trim()
      .split(/\s+/)
      .filter(t => t.length > 0);
    if (tokens.length < 2) return null;
    tokens.pop();
    return tokens.join(" ") + " |-";
  }

  private _normaliseLearned(s: string): string {
    return s.toLowerCase().replace(/\|-/g, "").replace(/\s+/g, " ").trim();
  }

  private _resultMatchesExpected(
    reproduced: string,
    expected: string
  ): boolean {
    const r = this._normaliseLearned(reproduced);
    const e = this._normaliseLearned(expected);
    if (r === e) return true;
    if (e.length > 0 && (r.includes(e) || e.includes(r))) return true;
    return false;
  }

  private _stateName(s: Memory.KnowledgeState): string {
    return ["Heard", "Remembered", "Learned", "Generalized"][s] ?? String(s);
  }

  /**
   * Attempts to reproduce the answer for a single vault candidate using probe
   * mode (no vault, no NLP-derived rules - pure topology).
   */
  public async challenge(
    candidate: Memory.ChallengeCandidate
  ): Promise<Memory.ChallengeResult> {
    const contextHash = this._contextFingerprint();
    const probeText = this._buildProbeText(candidate.factText);

    if (!probeText || !this.atomizer) {
      return {
        success: false,
        reproduced: "",
        expected: candidate.targetPattern,
        contextHash,
        coherence: 0,
        learned: [],
        hasGeneralizationSignal: false,
        diagnostics: null,
        probeIds: new Uint32Array(0),
      };
    }

    const probeIds = this.atomizer.ingestSequence(probeText, this.system);

    const coherentResult = await this.perceiveCoherent(probeIds, {
      probeMode: true,
      maxIterations: 3,
    });

    const reproduced = this.atomizer
      .decodeSequence(coherentResult.ids, this.system)
      .trim();

    const success =
      this._normaliseLearned(reproduced).length > 0 &&
      this._normaliseLearned(reproduced) !==
        this._normaliseLearned(probeText) &&
      this._normaliseLearned(reproduced) !== "unknown" &&
      this._resultMatchesExpected(reproduced, candidate.targetPattern);

    const factWords = new Set(candidate.factText.toLowerCase().split(/\s+/));
    const hasGeneralizationSignal =
      success &&
      (coherentResult.diagnostics?.bridgeCandidates ?? []).some(
        b =>
          !b.isMissingLink &&
          b.bridgeScore > 0.05 &&
          !factWords.has(b.label.toLowerCase())
      );

    logger.debug(
      `[LEARNER] challenge "${probeText}" → "${reproduced}" ` +
        `(expected: "${candidate.targetPattern}", ` +
        `coherence: ${coherentResult.coherence.toFixed(3)}, ` +
        `diagnosis: ${coherentResult.diagnosis}, success: ${success}, ` +
        `genSignal: ${hasGeneralizationSignal})`
    );

    return {
      success,
      reproduced,
      expected: candidate.targetPattern,
      contextHash,
      coherence: coherentResult.coherence,
      learned: coherentResult.learned,
      hasGeneralizationSignal,
      diagnostics: coherentResult.diagnostics,
      probeIds,
    };
  }

  private async _crystallizeLearnedPath(
    candidate: Memory.ChallengeCandidate,
    diagnostics: any,
    probeIds: Uint32Array,
    energy: number = 1.5
  ): Promise<void> {
    const diag = diagnostics;
    if (!diag || diag.sinkCandidates.length === 0) return;
    if (!this.store) return;

    const probeText = this._buildProbeText(candidate.factText);
    if (!probeText) return;

    const inputIds = probeIds;
    const best = diag.sinkCandidates[0];
    const outputIds = new Uint32Array([best.id]);

    await this.store.crystallizeProof(inputIds, outputIds, energy);
    await this.store.updateKnowledgeState(
      candidate.signature,
      energy >= 2.0 ? 3 : 2,
      candidate.reproductionCount + 2,
      candidate.contextHash
    );

    logger.debug(
      `[LEARNER] Crystallized learned path for "${candidate.factText}" ` +
        `→ "${best.label}" at 1.5× energy`
    );
  }

  /**
   * Autonomous learning cycle: samples low-confidence vault facts, challenges
   * each in probe mode, and promotes those whose answers can be reproduced in
   * 2+ distinct manifold contexts.
   */
  public async learnCycle(
    batchSize: number = 10
  ): Promise<Memory.ValidationReport> {
    if (!this.store) {
      return {
        challenged: 0,
        promoted: 0,
        failed: 0,
        expandedTopics: [],
        summary: { heard: 0, remembered: 0, learned: 0, generalized: 0 },
      };
    }
    const candidates = await this.store.sampleForChallenge(batchSize);
    const report: Memory.ValidationReport = {
      challenged: candidates.length,
      promoted: 0,
      failed: 0,
      expandedTopics: [],
      summary: { heard: 0, remembered: 0, learned: 0, generalized: 0 },
    };

    for (const candidate of candidates) {
      const existingHashes = new Set(
        candidate.contextHash.split("|").filter(Boolean)
      );
      let repCount = candidate.reproductionCount;

      const result1 = await this.challenge(candidate);
      // C4: update Christoffel correction based on challenge outcome.
      this._updateChristoffels(result1.success ? 1.0 : -0.5);
      let bestResult = result1;
      if (result1.success && !existingHashes.has(result1.contextHash)) {
        repCount++;
        existingHashes.add(result1.contextHash);
      }
      for (const l of result1.learned) {
        if (!report.expandedTopics.includes(l)) report.expandedTopics.push(l);
      }
      const generalizationFastTrack =
        result1.hasGeneralizationSignal && result1.success;

      let expandedTopic = "";

      // Env 2: related topic expansion.
      if (repCount < 2 && this.unfolder && this.atomizer) {
        const topic = extractTopic(candidate.factText);
        if (topic) {
          const voidScope = this.atomizer.getSymbolScope("void", false);
          const voidId = this.system.createLocation(-this.system.c, voidScope);
          const expanded = await this.unfolder.expand(voidId, topic);
          if (expanded) {
            expandedTopic = topic;
            report.expandedTopics.push(topic);
            const result2 = await this.challenge(candidate);
            if (result2.success) bestResult = result2;
            if (result2.success && !existingHashes.has(result2.contextHash)) {
              repCount++;
              existingHashes.add(result2.contextHash);
            }
          }
        }
      }

      // Env 3: unrelated noise expansion for Generalized promotion.
      if (
        repCount >= 2 &&
        candidate.knowledgeState < 3 &&
        this.unfolder &&
        this.atomizer
      ) {
        const factWords = candidate.factText.toLowerCase().split(/\s+/);
        const noiseTopic =
          Traveler.NOISE_PROBES.find(t => !factWords.includes(t)) ??
          Traveler.NOISE_PROBES[0];
        const noiseScope = this.atomizer.getSymbolScope("void", false);
        const noiseVoidId = this.system.createLocation(
          -this.system.c,
          noiseScope
        );
        const noiseExpanded = await this.unfolder.expand(
          noiseVoidId,
          noiseTopic
        );
        if (noiseExpanded) {
          const result3 = await this.challenge(candidate);
          if (result3.success) bestResult = result3;
          if (result3.success && !existingHashes.has(result3.contextHash)) {
            repCount++;
            existingHashes.add(result3.contextHash);
            if (!report.expandedTopics.includes(noiseTopic))
              report.expandedTopics.push(noiseTopic);
          }
        }
      }

      const prevState = candidate.knowledgeState;
      let newState: Memory.KnowledgeState = prevState;
      if ((repCount >= 3 || generalizationFastTrack) && prevState < 3) {
        newState = 3;
      } else if (repCount >= 2 && prevState < 2) {
        newState = 2;
      } else if (repCount >= 1 && prevState < 1) {
        newState = 1;
      }

      const newCtxHash = [...existingHashes].slice(0, 5).join("|");
      await this.store.updateKnowledgeState(
        candidate.signature,
        newState,
        repCount,
        newCtxHash
      );

      if (newState > prevState) {
        report.promoted++;
        if (newState >= 2) {
          await this._crystallizeLearnedPath(
            candidate,
            bestResult.diagnostics,
            bestResult.probeIds,
            newState === 3 ? 2.0 : 1.5
          );
        }
        logger.debug(
          `[LEARNER] "${candidate.factText}" promoted ` +
            `${this._stateName(prevState)} → ${this._stateName(newState)} ` +
            `(repCount=${repCount}${expandedTopic ? `, expanded="${expandedTopic}"` : ""})`
        );
      } else if (!result1.success && !expandedTopic) {
        report.failed++;
      }
    }

    // C4: decay Christoffel corrections toward zero once per learnCycle.
    this.regularizeChristoffels();

    report.summary = await this.store.getKnowledgeSummary();
    return report;
  }

  // ---- Inquiry internals --------------------------------------------------

  private _inquiryQueue: InquiryQueue | null = null;

  /**
   * Returns the InquiryQueue instance.  Lazy-initialised on first access so
   * Mappers built without a store (locomotion-only callers) still work.
   */
  public getInquiryQueue(): InquiryQueue {
    if (!this._inquiryQueue) {
      this._inquiryQueue = new InquiryQueue(this.store ?? undefined);
      this._inquiryQueue.onEnqueue = (topic: string) => {
        this.spawnIntent(topic, 2.0, IntentTag.INQUIRY_GAP);
      };
    }
    return this._inquiryQueue;
  }

  public enqueueInquiry(topic: string, query: string): void {
    this.getInquiryQueue().enqueue(topic, query);
  }

  public enqueueInquiryImmediate(topic: string, query: string): void {
    this.getInquiryQueue().enqueueImmediate(topic, query);
  }

  public async drainInquiries(n: number = 3): Promise<InquiryItem[]> {
    if (!this.atomizer) return [];
    return this.getInquiryQueue().step(
      n,
      this.unfolder,
      this,
      this.system,
      this.atomizer,
      this.store ?? undefined
    );
  }

  // ---- CognitiveLoop internals --------------------------------------------

  private _cogTimer: ReturnType<typeof setInterval> | null = null;
  private _learnerTimer: ReturnType<typeof setInterval> | null = null;
  private _intentIds = new Set<number>();
  private _intentTagMap = new Map<number, IntentTag>();
  private _intentFailureCount = new Map<number, number>();
  private _cogTickCount = 0;

  public registerIntent(id: number, tag: IntentTag): void {
    this._intentIds.add(id);
    this._intentTagMap.set(id, tag);
  }

  public spawnIntent(
    topic: string,
    energy: number = 1.0,
    tag: IntentTag = IntentTag.USER_UNKNOWN
  ): number | null {
    if (!this.atomizer) return null;
    const id = spawnIntentPrecept(
      this.system,
      this.atomizer,
      topic,
      energy,
      tag,
      this._intentTagMap
    );
    if (id !== null) this._intentIds.add(id);
    return id;
  }

  /** Hook for external listeners (LiveInference compatibility). */
  public onUnknown?: (topic: string) => void;

  public startAutonomy(
    opts: { intervalMs?: number; learnerIntervalMs?: number } = {}
  ): void {
    const cogTick =
      opts.intervalMs ??
      (DOPAT_CONFIG.observability as any).COGNITIVE_TICK_MS ??
      5_000;
    const learnerMs = opts.learnerIntervalMs ?? 10_000;

    if (this._cogTimer === null) {
      this._cogTimer = setInterval(
        () => this._cogTick().catch(e => logger.warn("[CLOOP]", e)),
        cogTick
      );
      logger.debug("[CLOOP] started");
    }

    if (this._learnerTimer === null && this.store) {
      let _cycles = 0;
      this._learnerTimer = setInterval(() => {
        this.learnCycle(5).catch(e => logger.warn("[LEARNER TIMER]", e));
        if (++_cycles % 6 === 0) {
          this.store
            ?.cullWeakWaveForms()
            .catch(e => logger.warn("[VAULT CULL]", e));
        }
      }, learnerMs);
    }
  }

  public stopAutonomy(): void {
    if (this._cogTimer !== null) {
      clearInterval(this._cogTimer);
      this._cogTimer = null;
    }
    if (this._learnerTimer !== null) {
      clearInterval(this._learnerTimer);
      this._learnerTimer = null;
    }
  }

  private async _cogTick(): Promise<void> {
    if (!this.atomizer || !this.store) return;
    this._cogTickCount++;

    // Session lifecycle: drift position back toward the pole on every idle tick.
    this._idleDriftToPole();

    // 1. SENSE - prune freed/decayed IDs
    for (const id of this._intentIds) {
      if (!this.system.isAllocated(id) || this.system.mass[id] <= 0) {
        this._intentIds.delete(id);
        this._intentTagMap.delete(id);
        this._intentFailureCount.delete(id);
      }
    }

    if (this._cogTickCount % 12 === 0) {
      this._scanVaultUnderexplored().catch(() => {});
    }

    if (this._intentIds.size === 0) return;

    // 2. SELECT
    let bestId = -1;
    let bestScore = -Infinity;
    for (const id of this._intentIds) {
      const failures = this._intentFailureCount.get(id) ?? 0;
      const rawScore = this.system.mass[id] * this.system.posW[id];
      const score = rawScore / (1 + failures * failures);
      if (score > bestScore) {
        bestScore = score;
        bestId = id;
      }
    }
    if (bestId < 0) return;

    const tag = this._intentTagMap.get(bestId) ?? IntentTag.USER_UNKNOWN;
    const topic = this.atomizer.resolveScope(this.system.scope[bestId]) ?? "";

    let success = false;
    try {
      switch (tag) {
        case IntentTag.INQUIRY_GAP:
          await this.drainInquiries(1);
          success = true;
          break;

        case IntentTag.CONSTELLATION_GAP: {
          if (topic) {
            const probeIds = this.atomizer.ingestSequence(topic, this.system);
            const result = await this.perceiveCoherent(probeIds, {
              probeMode: true,
              maxIterations: 3,
            });
            success =
              result.diagnosis === "coherent" || result.diagnosis === "weak";
          }
          break;
        }

        case IntentTag.VAULT_PROMOTE: {
          const candidates = await this.store.sampleForChallenge(1);
          if (candidates.length > 0) {
            await this.challenge(candidates[0]);
            success = true;
          }
          break;
        }

        case IntentTag.USER_UNKNOWN: {
          if (topic && this.unfolder) {
            const content = await this.unfolder.fetchContent(topic);
            if (content) {
              this.unfolder.ingestContent(content, this.system);
              success = true;
            }
          }
          break;
        }
      }
    } catch (e) {
      logger.warn(`[CLOOP] dispatch error for "${topic}":`, e);
    }

    if (success) {
      decayIntent(this.system, bestId, 0.5);
      this._intentFailureCount.delete(bestId);
    } else {
      decayIntent(this.system, bestId, 0.9);
      this._intentFailureCount.set(
        bestId,
        (this._intentFailureCount.get(bestId) ?? 0) + 1
      );
    }
  }

  private async _scanVaultUnderexplored(): Promise<void> {
    if (!this.store) return;
    try {
      const candidates = await this.store.sampleForChallenge(3);
      for (const c of candidates) {
        if (c.knowledgeState < 2) {
          this.spawnIntent(
            c.factText.split(" ")[0] ?? c.factText,
            1.5,
            IntentTag.VAULT_PROMOTE
          );
        }
      }
    } catch {}
  }

  // ---- Compound query prerequisite resolution --------------------------------

  /**
   * Enriches the manifold for a single sub-query topic.
   *
   * The Traveler asks "what do I need to know?" before traversing a long path.
   * This method answers one such prerequisite: it checks if the topic is
   * already represented (fast-exit via perceiveCoherent), and if not, calls
   * the Unfolder to fetch and ingest the missing knowledge.  The return value
   * is discarded; the side-effect on the manifold is the only goal.
   */
  private async _resolveSubQuery(subQuery: SubQuery): Promise<void> {
    if (!this.language || !this.unfolder) return;

    const ingestResult = this.language.ingest(subQuery.text);
    if (ingestResult.ids.length === 0) return;

    // Expand manifold knowledge for this prerequisite topic via Unfolder.
    // No vault fast-exit here: vault patterns are abstract (VAR_N) and can
    // falsely match unrelated entities (e.g. "sky is blue" matches any "X is Y"
    // query).  The Unfolder is idempotent - re-expanding a known topic is safe.
    const topic =
      ingestResult.attractionCenter ||
      subQuery.text
        .replace(/^what is |^how to /i, "")
        .replace(/\?$/, "")
        .trim();
    logger.log(
      `[Mapper] _resolveSubQuery: expanding "${topic}" (${subQuery.purpose})`
    );
    await this.unfolder.expand(
      ingestResult.ids[0],
      topic,
      this.store ?? undefined
    );
  }

  // ---- Process (Phase 4 lightweight stub) ---------------------------------

  /**
   * The single public entry for all text input. Coordinates ingestion,
   * skill election, execution, and learning.
   */
  public async process(text: string): Promise<string> {
    logger.log(`[Mapper] process entry: "${text}"`);
    if (!this.language || !this.atomizer) {
      return "unknown";
    }

    // 1. Ingest text via Language boundary
    const result = this.language.ingest(text);
    const {
      ids,
      intent,
      feedbackPolarity,
      correction,
      signature,
      shifted,
      isIdentityQuery,
    } = result;

    // 2. Handle synthesis trigger |-
    if (text.includes("|-")) {
      const parts = text.split("|-");
      const lhs = parts[0].trim();
      const rhs = parts[1].trim();

      if (!rhs) {
        // Synthesis mode (e.g. "function add |-")
        const ids = this.atomizer.ingestSequence(text, this.system);
        const res = await this.perceiveCoherent(ids);
        const decoded = this.atomizer
          .decodeSequence(res.ids, this.system)
          .trim();
        this.language.respond(decoded);
        return decoded;
      } else {
        // Ingestion mode
        if (intent === "code") {
          const handler = this.skills.get(this.electSkill(ids, "code"));
          if (handler) {
            const resp = await handler({
              query: text,
              queryIds: ids,
              system: this.system,
              store: this.store!,
              atomizer: this.atomizer,
              language: this.language,
            });
            this.language.respond(resp.answer);
            return resp.answer;
          }
        }
      }
    }

    // 3. Handle feedback intent
    if (intent === "feedback" && feedbackPolarity) {
      if (this.lastSignature && this.store) {
        const adjustment = feedbackPolarity === "positive" ? 0.1 : -0.5;
        const usageBoost =
          feedbackPolarity === "positive"
            ? DOPAT_CONFIG.memory.FEEDBACK_BOOST
            : 0;
        await this.store.adjustEnergy(this.lastSignature, adjustment);
        await this.store.adjustUsageCount(this.lastSignature, usageBoost);

        // Targeted feedback: also adjust the elected skill's mass
        if (this.lastSkillElected > 0) {
          const sys = this.system;
          if (sys.isAllocated(this.lastSkillElected)) {
            const currentMass = sys.mass[this.lastSkillElected];
            sys.mass[this.lastSkillElected] =
              feedbackPolarity === "positive"
                ? currentMass * 1.05
                : currentMass * 0.95;
          }
        }
      }

      if (correction) {
        // Recursive call for correction ingestion (processed as assertion)
        return this.process(correction).then(() => {
          const resp = `Feedback acknowledged. Correction ingested: "${correction}"`;
          this.language!.respond(resp);
          return resp;
        });
      }

      const resp = `Feedback acknowledged. Structural confidence ${
        feedbackPolarity === "positive" ? "increased" : "reduced"
      }.`;
      this.language.respond(resp);
      return resp;
    }

    // 4. Handle identity queries (direct response)
    if (isIdentityQuery) {
      const decoded = this.atomizer.decodeSequence(ids, this.system);
      this.language.respond(decoded);
      return decoded;
    }

    // 4b. Compound query pre-pass: identify knowledge prerequisites and resolve
    // them step-by-step before attempting full traversal.  This lets the
    // Traveler ask "what do I need to know to answer this?" and fill the gaps
    // so that perceiveCoherent can bridge the enriched manifold in one pass.
    let skillQueryIds = ids;
    if (
      this._decomposer &&
      this.unfolder &&
      intent === "question" &&
      this._decomposer.isCompound(result)
    ) {
      const subQueries = this._decomposer.decompose(text, result);
      if (subQueries.length > 0) {
        logger.log(
          `[Mapper] compound query: resolving ${subQueries.length} prerequisites`
        );
        for (const sq of subQueries) {
          await this._resolveSubQuery(sq);
        }
        // Force a topology rebuild so newly ingested atoms form domain clusters
        // (e.g. titanium + iridium + alloy → metallurgy supercluster) before the
        // synthesis perceiveCoherent runs and stores its framework-scoped proof.
        if (this.lifecycle) {
          this.lifecycle.consolidateAround([]);
          this.store?.setFrameworkIndex(this.lifecycle.getFrameworkIndex());
        }
        // Re-ingest the original query so the IDs reflect the enriched manifold
        skillQueryIds = this.language.ingest(text).ids;
      }
    }

    // 5. Elect a skill
    const skillId = this.electSkill(ids, intent);
    const handler = this.skills.get(skillId);

    if (!handler) {
      // Fallback to pure topology-only perception if no skill handler matches
      const percResult = await this.perceive(ids);
      const decoded = this.atomizer
        .decodeSequence(percResult, this.system)
        .trim();
      return decoded || "unknown";
    }

    this.lastSkillElected = skillId;
    this.lastSignature = signature;

    // 6. Execute skill handler
    try {
      const skillResult = await handler({
        query: shifted,
        queryIds: skillQueryIds,
        system: this.system,
        store: this.store!,
        atomizer: this.atomizer,
        language: this.language!,
        ingestResult: result,
      });

      logger.log(
        `[Mapper] Skill ${skillId} returned answer: ${skillResult.answer}`
      );

      const { answer, confidence } = skillResult;

      if (!answer || answer === "unknown") {
        // Handle unknown by enqueuing inquiry and emitting a response.
        const topic = extractTopic(shifted);
        if (topic && classifyOperatorToken(topic) === OperatorClass.None) {
          this.enqueueInquiry(topic, shifted);
        }
        this.language?.respond("unknown");
        return "unknown";
      }

      // 7. Post-success learning: reinforce path
      if (confidence > 0.5) {
        // Reinforce the connection between the query and the skill
        // This makes the skill "heavier" in the manifold for this query type.
        reinforcePath(new Uint32Array([0, ...ids, skillId, 0]), this.system);
      }

      // 8. Record conclusion in Working Memory
      // (This replaces logic scattered in LiveInference)
      const conclusionId = this.lastDiagnostics?.sinkCandidates[0]?.id ?? 0;
      const conclusionScope =
        conclusionId > 0 && this.system.isAllocated(conclusionId)
          ? this.system.scope[conclusionId]
          : 0;

      this.language.recordConclusion(
        text,
        answer,
        conclusionScope,
        conclusionId,
        this.lastDiagnostics?.bridgeCandidates ?? []
      );

      this.language.respond(answer);
      return answer;
    } catch (e) {
      logger.error(`[Mapper] process error in skill ${skillId}:`, e);
      return "error";
    }
  }

  // ---- Backward-compat aliases (deprecated) --------------------------------

  /** @deprecated Use process(). */
  async processIntent(text: string): Promise<string> {
    return this.process(text);
  }
  /** @deprecated Use process(). */
  async processQuestion(text: string): Promise<string> {
    return this.process(text);
  }
  /** @deprecated Use process(). */
  async processCommand(text: string): Promise<string> {
    return this.process(text);
  }
  /** @deprecated Use process(). */
  async processCode(text: string): Promise<string> {
    return this.process(text);
  }

  /** @deprecated Set language.setRespond() directly. */
  set respond(cb: (msg: string) => void) {
    this.language?.setRespond(cb);
  }
  /** @deprecated Use language.getRespond() directly. */
  get respond(): (msg: string) => void {
    return this.language?.getRespond() ?? (() => {});
  }
  /** @deprecated Set language.setRespond() directly. */
  set onResponse(cb: (msg: string) => void) {
    this.language?.setRespond(cb);
  }

  /** @deprecated Use learnCycle() directly. */
  getLearner(): { runCycle: (n?: number) => Promise<Memory.ValidationReport> } {
    return { runCycle: (n = 5) => this.learnCycle(n) };
  }

  /** @deprecated Access language.workingMemory directly. */
  getWorkingMemory(): WorkingMemory | null {
    return (this.language as any)?.workingMemory ?? null;
  }
}

/** Back-compat alias - import Traveler from "@core_i/Traveler" for new code. */
export type { Traveler as Mapper };
export default Traveler;

export function getMetricForceWithInnerDerivative(
  traveler: Traveler,
  px: number,
  py: number,
  pz: number,
  pw: number,
  pens: any[],
  boost: Set<number> | undefined,
  activeAtoms?: Set<number>
): [V: number, fx: number, fy: number, fz: number, fw: number] {
  return traveler.getMetricForceWithInnerDerivative(
    px,
    py,
    pz,
    pw,
    pens,
    boost,
    activeAtoms
  );
}
