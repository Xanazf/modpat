import { createHash } from "node:crypto";
import nlp from "compromise";

import { DOPAT_CONFIG } from "@config";
import { TensorMath_GPU } from "@core_s/Math";
import { metrics } from "@core_s/Metrics";
import { CURVATURE_WGSL } from "@props/Curvature";
import type Store from "@core_s/Memory";
import type Unfolder from "@mutate/Unfolder";
import {
  boostIntent,
  decayIntent,
  IntentTag,
  spawnIntent as spawnIntentPrecept,
} from "@utils/intentPrecept";
import { GridIndex4D } from "@mutate/GridIndex4D";
import type { PersistenceBar } from "@core_s/PersistentHomology";
import {
  resolveActiveAtoms,
  type FrameworkId,
  type Matrix4x4,
  type TravelerState,
} from "@mutate/FrameworkIndex";
import type { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";

import { multiplyMatrices4x4 } from "@i_topology/HoTTKernel";
import type { SkillHandler } from "./skills";
import { type CodePattern, Synthesizer } from "@skill_code/Coder";
import { InquiryQueue, type InquiryItem } from "@skill_cogi/InquiryQueue";
import type { Language } from "@skill_lang/Language";
import type { WorkingMemory } from "@skill_lang/WorkingMemory";
import {
  TravelerWorkspace,
  TravelerWorkspacePool,
} from "@i_topology/Walkspace";
import {
  classifyOperatorToken,
  OperatorClass,
  SlotType,
  SystemRef,
} from "./System";
import logger from "@utils/SpectralLogger";
import { extractTopic } from "@utils/topicExtraction";

/**
 * Per-call inputs to perceive / perceiveCoherent / probe.
 *
 * Threading these through the call instead of via instance fields is what
 * makes the engine safe when CognitiveLoop, Learner, dream cycle and user
 * input call the same Mapper concurrently. Callers that don't set them get
 * the existing instance-level defaults.
 */
export interface PerceptionOptions {
  /**
   * Scopes from the caller's working memory. Tokens in the sequence whose
   * scope appears here receive a warm-start energy bonus in the forward
   * propagation pass (Phase 2).
   */
  contextScopes?: Set<number>;
  /**
   * When true, perceive skips Phase 0 (vault recall) and Phase 1
   * (NLP-derived rules). Used by learnCycle/challenge to verify that the
   * physics alone can reproduce the answer.
   */
  probeMode?: boolean;
}

/** Backward-compat alias. */
export type ResolveOptions = PerceptionOptions;

/**
 * Result returned by perceiveCoherent: the best answer found, a coherence score,
 * how many iterations it took, what actions the loop took, and why it stopped.
 */
export interface CoherentResult {
  /** The best answer IDs found (empty if the wave never converged). */
  ids: Uint32Array;
  /**
   * Coherence score in [0, 1]: amplitude (normalised sink strength) multiplied by
   * contrast (how far ahead the winner is of the second-best candidate).
   * Values >= COHERENCE_THRESHOLD are considered a found answer.
   */
  coherence: number;
  /** Number of perceive passes executed. */
  iterations: number;
  /**
   * Human-readable log of actions taken during the convergence loop:
   * void expansions, conflict notes, reinforcement boosts.
   */
  learned: string[];
  /**
   * Why the loop stopped.
   */
  diagnosis: "coherent" | "void" | "conflict" | "weak" | "exhausted";
  /**
   * Diagnostics from the iteration whose answer was chosen as the best.
   */
  diagnostics: PerceptionDiagnostics | null;
}

/**
 * A token that sits at the intersection of the forward and backward resonance waves.
 */
export interface BridgeCandidate {
  idx: number;
  id: number;
  label: string;
  forwardEnergy: number;
  backwardEnergy: number;
  bridgeScore: number;
  isMissingLink: boolean;
}

/** A token found by resonance-peak analysis to exhibit operator-like wave topology. */
export interface DiscoveredOperator {
  id: number;
  idx: number;
  label: string;
  inferredClass: OperatorClass;
  confidence: number;
  outboundRatio: number;
}

export interface PerceptionDiagnostics {
  N: number;
  tokenLabels: string[];
  operatorClasses: number[];
  W: Float64Array;
  accumulated: Float64Array;
  sinkCandidates: Array<{
    idx: number;
    id: number;
    label: string;
    strength: number;
    posX: number;
    posY: number;
    posZ: number;
    posW: number;
    opClass: number;
  }>;
  selectedTargetIdx: number;
  maxNetEnergy: number;
  discoveredOperators: DiscoveredOperator[];
  bridgeCandidates: BridgeCandidate[];
}

/**
 * Capture returned by perceiveCapturing: race-free snapshot under the
 * workspace lock.
 */
export interface PerceptionCapture {
  ids: Uint32Array;
  diagnostics: PerceptionDiagnostics | null;
  sinkStrength: number;
  discoveredOperators: DiscoveredOperator[];
  bridgeCandidates: BridgeCandidate[];
}

/**
 * D3 – Result of a path homotopy check between two traversals.
 */
export interface HomotopyResult {
  /** True if the loop path₁ + reversed(path₂) encloses no persistent H₁ generator. */
  homotopic: boolean;
  /** H₁ bars whose generator atoms are enclosed by the loop. */
  straddledH1Bars: PersistenceBar[];
  /** [0, 1] - 0 = homotopic, 1 = all qualified generators straddled. */
  analogyScore: number;
}

/**
 * Integer winding number of the 2D polygon `loop` around the point (gx, gy).
 * Uses the non-zero rule: +1 for upward crossings left of the point, −1 for downward.
 */
function windingNumber(
  loop: [number, number][],
  gx: number,
  gy: number
): number {
  let wn = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = loop[i];
    const [x2, y2] = loop[(i + 1) % n];
    if (y1 <= gy) {
      if (y2 > gy) {
        if ((x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1) > 0) wn++;
      }
    } else {
      if (y2 <= gy) {
        if ((x2 - x1) * (gy - y1) - (y2 - y1) * (gx - x1) < 0) wn--;
      }
    }
  }
  return wn;
}

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
  private gpu: TensorMath_GPU | null = null;
  /** Optional Fractal Unfolder for expanding logical voids. */
  private unfolder: Unfolder | null = null;
  /** WebGPU pipeline for geodesic calculations. */
  private geodesicPipeline: GPUComputePipeline | null = null;
  /** 4D spatial index used by the locomotion gradient descent. */
  private readonly gridIndex = new GridIndex4D();
  /** Synthesizer for collapsing logical paths into TypeScript code. */
  private synthesizer: Synthesizer;
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

  // Perception state (was on Resolver)

  /** Maximum capacity for the pre-allocated perception buffers. */
  private static MAX_SEQUENCE_LENGTH = 1024;
  /** Default workspace pool size. */
  private static DEFAULT_POOL_SIZE = 8;
  /** Per-call workspace pool. */
  private readonly workspacePool: TravelerWorkspacePool;
  /** 4D spatial index reused across fuzzy-centroid lookups in perception. */
  private readonly spatialIndex = new GridIndex4D();
  private lastIndexedLength = -1;

  /** Evidence accumulator for operator discovery. */
  private operatorEvidence = new Map<
    number,
    { cls: OperatorClass; count: number }
  >();

  /** Sink strength of the most recent completed perceive call (race-prone). */
  public lastSinkStrength = 0;
  /** Full diagnostic snapshot from the most recent perceive call. */
  public lastDiagnostics: PerceptionDiagnostics | null = null;
  /** Operators discovered via resonance during the most recent perceive call. */
  public lastDiscoveredOperators: DiscoveredOperator[] = [];
  /** TRAVELER step 3: answer IDs from the most recent perceiveCoherent() call, for shadow comparison. */
  private _lastCoherentIds: Uint32Array | null = null;
  /** P2: times φ was clamped to PHI_MAX; non-zero means a pathologically dense region was hit. */
  public phiClippedCount = 0;

  // -- D2: Parallel transport (holonomy) --------------------------------------
  /**
   * 4×4 holonomy matrix accumulated along the most recently relaxed geodesic.
   * Initialized to the identity; updated by computeHolonomy() after each CPU
   * path relaxation.  Measures how an evidence vector rotates along the path.
   */
  public readonly lastHolonomy = new Float64Array(16);
  /**
   * Inferential effort scalar: ||H − I||_F / 4 where H is lastHolonomy.
   * 0 = perfectly straight geodesic (easy inference), higher = more curvature
   * accumulated (creative leap).  Surfaced as a confidence signal.
   */
  public lastInferentialEffort = 0;

  // -- C4: Learned Christoffel corrections ------------------------------------
  /**
   * ΔΓᵢⱼᵏ: learned correction tensor (4×4×4 = 64 floats, indexed [i*16+j*4+k]).
   * Applied as an additional geodesic deviation force during relaxPath.
   * Initialised to zero; the prescribed conformal metric dominates until
   * sufficient vault-hit / trap training signal accrues.
   */
  public readonly deltaGamma = new Float64Array(64);
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
   * Set of scopes from working memory used as warm-start context for the
   * forward pass. Deprecated in favour of `opts.contextScopes` for concurrent
   * callers; kept for sequential back-compat.
   */
  public contextScopes: Set<number> = new Set();

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
    gpu: TensorMath_GPU | null = null,
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
    this.synthesizer = new Synthesizer();

    // D2: seed holonomy as identity matrix.
    this.lastHolonomy[0] =
      this.lastHolonomy[5] =
      this.lastHolonomy[10] =
      this.lastHolonomy[15] =
        1;

    // TRAVELER step 2: seed accumulated session holonomy as identity.
    this.holonomyFrame[0] =
      this.holonomyFrame[5] =
      this.holonomyFrame[10] =
      this.holonomyFrame[15] =
        1;

    this.workspacePool = new TravelerWorkspacePool(
      Traveler.DEFAULT_POOL_SIZE,
      Traveler.MAX_SEQUENCE_LENGTH
    );

    // Initialize GPU offloading if configured.
    if (DOPAT_CONFIG.USE_GPU && !this.gpu) {
      TensorMath_GPU.getDevice()
        .then(() => {
          this.gpu = new TensorMath_GPU();
        })
        .catch(e => {
          console.warn(
            "GPU Acceleration failed to initialize, falling back to CPU:",
            e.message
          );
        });
    }
  }

  // -------------------------------------------------------------------------
  // GPU / Unfolder wiring
  // -------------------------------------------------------------------------

  public setGPU(gpu: TensorMath_GPU | null): void {
    this.gpu = gpu;
    this.geodesicPipeline = null; // force re-creation with updated shader
  }

  /** Backward-compat alias. */
  public setGPUEnabled(enabled: boolean): void {
    if (enabled) {
      if (!this.gpu) {
        TensorMath_GPU.getDevice().then(() => {
          this.gpu = new TensorMath_GPU();
        });
      }
    } else {
      this.gpu = null;
      this.geodesicPipeline = null;
    }
  }

  public setUnfolder(unfolder: Unfolder | null): void {
    this.unfolder = unfolder;
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
    const steps = options.steps ?? 32;
    const boostScopes = options.boostScopes;
    const learningRate = options.learningRate ?? 0.05;
    const maxIterations = options.maxIterations ?? 100;
    const activeAtoms = options.activeAtoms;

    const px = new Float64Array(steps + 1);
    const py = new Float64Array(steps + 1);
    const pe = new Float64Array(steps + 1);
    const pa = new Float64Array(steps + 1);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      px[i] =
        this.system.posX[sourceId] +
        t * (this.system.posX[targetId] - this.system.posX[sourceId]);
      py[i] =
        this.system.posY[sourceId] +
        t * (this.system.posY[targetId] - this.system.posY[sourceId]);
      pe[i] =
        this.system.posZ[sourceId] +
        t * (this.system.posZ[targetId] - this.system.posZ[sourceId]);
      pa[i] =
        this.system.posW[sourceId] +
        t * (this.system.posW[targetId] - this.system.posW[sourceId]);
    }

    const penalties: {
      x: number;
      y: number;
      z: number;
      w: number;
      strength: number;
    }[] = [];
    let finalIds: Uint32Array | null = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      this.buildGridIndex();
      if (this.gpu) {
        metrics.increment("mapper.gpu_dispatches");
        await this.relaxPathGPU(
          px,
          py,
          pe,
          pa,
          steps,
          maxIterations,
          learningRate,
          boostScopes,
          penalties
        );
      } else {
        metrics.increment("mapper.cpu_dispatches");
        this.relaxPath(
          px,
          py,
          pe,
          pa,
          steps,
          maxIterations,
          learningRate,
          boostScopes,
          penalties,
          activeAtoms
        );
      }

      if (this.unfolder) {
        let voidDetected = false;
        for (let i = 0; i <= steps; i++) {
          const { potential, nearestId } = this.getPotentialAndNearest(
            px[i],
            py[i],
            pe[i],
            pa[i],
            penalties,
            boostScopes,
            activeAtoms
          );
          if (potential > DOPAT_CONFIG.PHYSICS.VOID_POTENTIAL_THRESHOLD) {
            if (nearestId !== -1) {
              let expanded = await this.unfolder.expand(
                nearestId,
                options.topic
              );
              if (!expanded && options.topic) {
                const terms = nlp(options.topic).terms().out("array");
                for (const term of terms) {
                  const tExpanded = await this.unfolder.expand(nearestId, term);
                  if (tExpanded) expanded = true;
                }
              }
              if (expanded) {
                metrics.increment("mapper.void_expansions");
                voidDetected = true;
                break;
              }
            }
          }
        }
        if (voidDetected) {
          if (this.gpu)
            await this.relaxPathGPU(
              px,
              py,
              pe,
              pa,
              steps,
              maxIterations,
              learningRate,
              boostScopes,
              penalties
            );
          else
            this.relaxPath(
              px,
              py,
              pe,
              pa,
              steps,
              maxIterations,
              learningRate,
              boostScopes,
              penalties,
              activeAtoms
            );
        }
      }

      const report = this.review(px, py, pe, pa, steps, activeAtoms);
      if (report.passed) {
        metrics.record("mapper.iters_to_converge", attempt + 1);
        finalIds = this.extractIds(
          px,
          py,
          pe,
          pa,
          steps,
          options.preExpandLength || 0,
          targetId
        );
        // C4: reinforce the Christoffel correction for this successful traversal.
        this._updateChristoffels(1.0);
        break;
      } else if (report.trapIndex !== undefined) {
        penalties.push({
          x: px[report.trapIndex],
          y: py[report.trapIndex],
          z: pe[report.trapIndex],
          w: pa[report.trapIndex],
          strength: DOPAT_CONFIG.mapper.TRAP_PENALTY,
        });
        // C4: penalize the Christoffel correction - this direction led to a trap.
        this._updateChristoffels(-1.0);
      }
    }

    // D2: Compute holonomy from the final relaxed path - works for both CPU and GPU paths.
    this._computeHolonomy(px, py, pe, pa, steps);
    if (finalIds !== null)
      metrics.gauge("transport.inferential_effort", this.lastInferentialEffort);

    const result =
      finalIds ||
      this.extractIds(
        px,
        py,
        pe,
        pa,
        steps,
        options.preExpandLength || 0,
        targetId
      );

    // TRAVELER step 2: update persistent geometric state after each traversal.
    this._updateTravelerState(targetId, result);

    this.reinforcePath(result);
    return result;
  }

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

  // -- TRAVELER step 3: Observe → Follow → Read ------------------------------

  /**
   * Observe → Follow → Read: the full replacement for the Phase 0-7
   * transfer-matrix pipeline.
   *
   * Observe:
   *   Phase 0b  Vault recall by sequence signature (fast path for crystallised
   *             knowledge, same as the old pipeline's Phase 0b).
   *   Phase 0   PartLayer topology walk (same as the old pipeline's Phase 0).
   *
   * Follow:
   *   When neither vault nor topology produce an answer, integrates a probe
   *   from the input centroid under the manifold metric force (∇φ) for up to
   *   SETTLE_MAX_TICKS steps to identify the relevant cluster.  When
   *   POLE_INGESTION_ENABLED is true, consumption of drift targets from
   *   Language orients the probe toward the embedding-derived cluster.
   *
   * Read:
   *   Source = heaviest input atom (or nearest to accumulated Traveler
   *   position once it has moved).  Sink = atom nearest the settled probe.
   *   traverse(source, sink) - the geodesic path IS the inference.
   *   Holonomy of the traversal carries the confidence signal.
   *
   * Activated by SETTLING_GRADIENT_ENABLED=true; also used directly for
   * shadow comparison (SETTLING_GRADIENT_SHADOW=true, step 3).
   */
  public async observeSettlingGradient(
    ids: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    if (ids.length === 0) return new Uint32Array(0);
    const N = ids.length;

    // -- Phase 0b: vault recall ---------------------------------------------
    if (!opts.probeMode) {
      const derivation = await this.resolveSemanticDerivation(ids);
      if (derivation) {
        if (this.store) {
          this.boostAtomMasses(ids);
          this.boostAtomMasses(derivation);
        }
        return derivation;
      }
    }

    // -- Phase 0: PartLayer topology walk -----------------------------------
    const lastId = ids[N - 1];
    const lastClass = this.system.operatorClass[lastId];
    let queryOpId = lastId,
      queryOpClass = lastClass;
    let subjectIds = ids.slice(0, N - 1);

    if (lastClass === OperatorClass.Sink && N >= 3) {
      const prevId = ids[N - 2];
      if (this.system.operatorClass[prevId] === OperatorClass.IdentityShift) {
        queryOpId = prevId;
        queryOpClass = this.system.operatorClass[prevId];
        subjectIds = ids.slice(0, N - 2);
      }
    }

    if (queryOpClass === OperatorClass.IdentityShift && subjectIds.length > 0) {
      const topoResult = this.resolveMultiTokenSemanticLookup(
        subjectIds,
        queryOpId
      );
      if (topoResult.length > 0) {
        if (!opts.probeMode && this.store) {
          await this.store.crystallizeProof(ids, topoResult, 1.0);
          this.boostAtomMasses(ids);
          this.boostAtomMasses(topoResult);
        }
        return topoResult;
      }
    }

    // -- Phase 0.5: code synthesis fast-path -------------------------------
    if (
      this.store &&
      N > 0 &&
      this.system.operatorClass[ids[N - 1]] === OperatorClass.Sink
    ) {
      const synthResult = await this.resolveCodeSynthesis(ids);
      const decoded = this.atomizer
        .decodeSequence(synthResult, this.system)
        .trim();
      if (decoded && decoded !== "unknown") return synthResult;
    }

    // E0 active frameworks resolution
    let activeAtoms: Set<number> | undefined = undefined;
    if (this.lifecycle) {
      const index = this.lifecycle.getFrameworkIndex();
      if (index && this.activeFrameworks.size > 0) {
        activeAtoms = resolveActiveAtoms(index, this.activeFrameworks);
      }
    }

    // -- Observe: settle probe from input centroid under manifold force ------
    this.buildGridIndex();
    const driftTargets =
      this.language?.takeDriftTargets() ??
      new Map<number, readonly [number, number, number, number]>();

    // Individual atom settling under POLE_INGESTION_ENABLED
    if (DOPAT_CONFIG.PHYSICS.POLE_INGESTION_ENABLED && driftTargets.size > 0) {
      this._settleAtoms(ids, driftTargets, opts.contextScopes, activeAtoms);
      this.buildGridIndex(); // Rebuild grid index with the newly settled atom positions
    }

    const settled = this._settleProbe(
      ids,
      driftTargets,
      opts.contextScopes,
      activeAtoms
    );
    if (!settled) return this.atomizer.ingestSequence("unknown", this.system);

    const { x: sx, y: sy, z: sz, w: sw } = settled;

    // -- Follow: identify source and sink atoms -----------------------------
    const nearRadius = Math.sqrt(DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS);

    const sinkId = this.gridIndex.nearest(
      sx,
      sy,
      sz,
      sw,
      nearRadius * 4,
      this.system,
      activeAtoms
    );
    if (sinkId === -1)
      return this.atomizer.ingestSequence("unknown", this.system);

    const travelerDisp =
      this.position[0] ** 2 +
      this.position[1] ** 2 +
      this.position[2] ** 2 +
      this.position[3] ** 2;

    let sourceId: number;
    if (travelerDisp > 0.01) {
      sourceId = this.gridIndex.nearest(
        this.position[0],
        this.position[1],
        this.position[2],
        this.position[3],
        nearRadius * 4,
        this.system,
        activeAtoms
      );
      if (sourceId === -1) sourceId = this._heaviestInput(ids);
    } else {
      sourceId = this._heaviestInput(ids);
    }

    if (sourceId === -1 || sourceId === sinkId) {
      const candidates = this.gridIndex
        .candidatesInRadius(sx, sy, sz, sw, nearRadius)
        .filter(id => this.system.isAllocated(id));
      const filtered =
        activeAtoms !== undefined
          ? candidates.filter(id => activeAtoms.has(id))
          : candidates;
      return new Uint32Array(
        filtered
          .sort((a, b) => this.system.mass[b] - this.system.mass[a])
          .slice(0, 16)
      );
    }

    // -- Read: traverse source → sink; path IS the inference -----------------
    return this.traverse(sourceId, sinkId, {
      boostScopes: opts.contextScopes,
      activeAtoms,
    });
  }

  /**
   * Integrates the positions of newly ingested atoms starting from the pole
   * toward their embedding drift targets under the manifold metric potential
   * and a soft spring force.
   */
  private _settleAtoms(
    ids: Uint32Array,
    driftTargets: Map<number, readonly [number, number, number, number]>,
    boost?: Set<number>,
    activeAtoms?: Set<number>
  ): void {
    const step = DOPAT_CONFIG.PHYSICS.GRADIENT_STEP;
    const maxTicks = DOPAT_CONFIG.PHYSICS.SETTLE_MAX_TICKS;
    const threshold = DOPAT_CONFIG.PHYSICS.SETTLE_CONVERGENCE_THRESHOLD;
    const DRIFT_SPRING = 0.1;

    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (!this.system.isAllocated(id)) continue;
      const target = driftTargets.get(id);
      if (!target) continue;

      const [tx, ty, tz, tw] = target;
      let px = this.system.posX[id];
      let py = this.system.posY[id];
      let pz = this.system.posZ[id];
      let pw = this.system.posW[id];

      for (let tick = 0; tick < maxTicks; tick++) {
        // Exclude the atom itself to avoid self-attraction.
        const [, fx, fy, fz, fw] = this.getMetricForce(
          px,
          py,
          pz,
          pw,
          [],
          boost,
          activeAtoms
        );
        const dx = (-fx + (tx - px) * DRIFT_SPRING) * step;
        const dy = (-fy + (ty - py) * DRIFT_SPRING) * step;
        const dz = (-fz + (tz - pz) * DRIFT_SPRING) * step;
        const dw = (-fw + (tw - pw) * DRIFT_SPRING) * step;

        px += dx;
        py += dy;
        pz += dz;
        pw += dw;

        if (Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) < threshold) break;
      }

      this.system.posX[id] = px;
      this.system.posY[id] = py;
      this.system.posZ[id] = pz;
      this.system.posW[id] = pw;
      this.system.update(id);
    }
  }

  /**
   * Integrates a probe point from the centroid of `ids` under the manifold
   * metric force for up to SETTLE_MAX_TICKS steps.
   * Returns the converged {x, y, z, w} or null when `ids` is empty.
   */
  private _settleProbe(
    ids: Uint32Array,
    driftTargets: Map<number, readonly [number, number, number, number]>,
    boost?: Set<number>,
    activeAtoms?: Set<number>
  ): { x: number; y: number; z: number; w: number } | null {
    // Compute input centroid
    let cx = 0,
      cy = 0,
      cz = 0,
      cw = 0,
      n = 0;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (!this.system.isAllocated(id)) continue;
      cx += this.system.posX[id];
      cy += this.system.posY[id];
      cz += this.system.posZ[id];
      cw += this.system.posW[id];
      n++;
    }
    if (n === 0) return null;
    cx /= n;
    cy /= n;
    cz /= n;
    cw /= n;

    // If POLE_INGESTION_ENABLED is true, the atoms have already been individually settled
    // by _settleAtoms. Return their centroid directly as the stable target coordinates.
    if (DOPAT_CONFIG.PHYSICS.POLE_INGESTION_ENABLED) {
      return { x: cx, y: cy, z: cz, w: cw };
    }

    let driftTx = 0,
      driftTy = 0,
      driftTz = 0,
      driftTw = 0,
      driftN = 0;
    if (driftTargets.size > 0) {
      for (const [, [tx, ty, tz, tw]] of driftTargets) {
        driftTx += tx;
        driftTy += ty;
        driftTz += tz;
        driftTw += tw;
        driftN++;
      }
      if (driftN > 0) {
        driftTx /= driftN;
        driftTy /= driftN;
        driftTz /= driftN;
        driftTw /= driftN;
      }
    }
    // Soft spring weight: hint contributes alongside metric force but never overrides it.
    const DRIFT_SPRING = 0.1;

    // Discrete settling: follow gradient (+ optional drift hint) toward highest-density cluster
    let px = cx,
      py = cy,
      pz = cz,
      pw = cw;
    const step = DOPAT_CONFIG.PHYSICS.GRADIENT_STEP;
    const maxTicks = DOPAT_CONFIG.PHYSICS.SETTLE_MAX_TICKS;
    const threshold = DOPAT_CONFIG.PHYSICS.SETTLE_CONVERGENCE_THRESHOLD;

    for (let tick = 0; tick < maxTicks; tick++) {
      const [, fx, fy, fz, fw] = this.getMetricForce(
        px,
        py,
        pz,
        pw,
        [],
        boost,
        activeAtoms
      );
      // fx/fy/fz/fw is ∂V/∂x pointing AWAY from clusters (V is minimum at clusters).
      // Move in direction -∇V = toward clusters, plus optional drift spring.
      const dx =
        (-fx + (driftN > 0 ? (driftTx - px) * DRIFT_SPRING : 0)) * step;
      const dy =
        (-fy + (driftN > 0 ? (driftTy - py) * DRIFT_SPRING : 0)) * step;
      const dz =
        (-fz + (driftN > 0 ? (driftTz - pz) * DRIFT_SPRING : 0)) * step;
      const dw =
        (-fw + (driftN > 0 ? (driftTw - pw) * DRIFT_SPRING : 0)) * step;
      px += dx;
      py += dy;
      pz += dz;
      pw += dw;

      if (Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) < threshold) break;
    }

    return { x: px, y: py, z: pz, w: pw };
  }

  /** Returns the ID of the highest-mass allocated atom in `ids`, or -1. */
  private _heaviestInput(ids: Uint32Array): number {
    let bestId = -1,
      bestMass = -Infinity;
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k];
      if (!this.system.isAllocated(id)) continue;
      const m = this.system.mass[id];
      if (m > bestMass) {
        bestMass = m;
        bestId = id;
      }
    }
    return bestId;
  }

  /**
   * Compares two atom ID sets (Jaccard) and their 4D centroid vectors (cosine),
   * logs the result, and emits metrics.  Used by the step-3 shadow comparison.
   */
  private _shadowCompare(
    oldIds: Uint32Array,
    newIds: Uint32Array,
    label: string
  ): { jaccard: number; cosine: number } {
    const setA = new Set(Array.from(oldIds));
    const setB = new Set(Array.from(newIds));
    let intersect = 0;
    for (const id of setA) if (setB.has(id)) intersect++;
    const union = setA.size + setB.size - intersect;
    const jaccard = union === 0 ? 1 : intersect / union;

    const mA = this._meanPos(oldIds);
    const mB = this._meanPos(newIds);
    const dot = mA[0] * mB[0] + mA[1] * mB[1] + mA[2] * mB[2] + mA[3] * mB[3];
    const magA = Math.sqrt(mA.reduce((s, v) => s + v * v, 0)) + 1e-12;
    const magB = Math.sqrt(mB.reduce((s, v) => s + v * v, 0)) + 1e-12;
    const cosine = dot / (magA * magB);

    logger.log(
      `[TRAVELER shadow] "${label}" old=${oldIds.length} new=${newIds.length} ` +
        `jaccard=${jaccard.toFixed(3)} cosine=${cosine.toFixed(3)}`
    );
    metrics.gauge("traveler.shadow_jaccard", jaccard);
    metrics.gauge("traveler.shadow_cosine", cosine);

    return { jaccard, cosine };
  }

  /** Returns the mean 4D position vector of allocated atoms in `ids`. */
  private _meanPos(ids: Uint32Array): [number, number, number, number] {
    let x = 0,
      y = 0,
      z = 0,
      w = 0,
      n = 0;
    for (const id of ids) {
      if (!this.system.isAllocated(id)) continue;
      x += this.system.posX[id];
      y += this.system.posY[id];
      z += this.system.posZ[id];
      w += this.system.posW[id];
      n++;
    }
    if (n === 0) return [0, 0, 0, 0];
    return [x / n, y / n, z / n, w / n];
  }

  /** Persists TravelerState to DuckDB. No-op when no store is attached. */
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

  /** Loads TravelerState from DuckDB and applies it. No-op when no store or no saved state. */
  public async loadState(sessionId: string): Promise<void> {
    if (!this.store) return;
    const state = await this.store.loadTravelerState(sessionId);
    if (state) this.applyState(state);
  }

  /**
   * Reinforces the inferential mass of atoms along a successfully computed path.
   */
  private reinforcePath(path: Uint32Array): void {
    const sys = this.system;
    const REINFORCE_FACTOR = 1.05;
    const MAX_REINFORCE_MASS = sys.c * 20;

    for (let i = 1; i < path.length - 1; i++) {
      const id = path[i];
      if (!sys.isAllocated(id)) continue;
      if (sys.operatorClass[id] !== 0) continue;
      const m = sys.mass[id];
      if (m <= 0) continue;
      sys.mass[id] = Math.min(m * REINFORCE_FACTOR, MAX_REINFORCE_MASS);
      sys.update(id);
    }
  }

  private async relaxPathGPU(
    px: Float64Array,
    py: Float64Array,
    pe: Float64Array,
    pa: Float64Array,
    steps: number,
    maxIterations: number,
    learningRate: number,
    boostScopes: Set<number> | undefined,
    penalties: any[]
  ): Promise<void> {
    if (!this.geodesicPipeline) await this.initGPUPipeline();
    const device = await TensorMath_GPU.getDevice();
    const sysLength = this.system.length;

    const sysInfluence = new Float32Array(sysLength);
    const sysSlotType = new Uint32Array(sysLength);
    for (let j = 0; j < sysLength; j++) {
      let influence =
        this.system.density[j] * 2.0 + this.system.intensity[j] * 1.5 + 5.0;
      if (boostScopes?.has(this.system.scope[j])) {
        influence += 50.0;
      }
      sysInfluence[j] = influence;
      sysSlotType[j] = this.system.slotType[j];
    }

    const penaltyData = new Float32Array(Math.max(1, penalties.length) * 8);
    penalties.forEach((p, i) => {
      penaltyData[i * 8 + 0] = p.x;
      penaltyData[i * 8 + 1] = p.y;
      penaltyData[i * 8 + 2] = p.z;
      penaltyData[i * 8 + 3] = p.w;
      penaltyData[i * 8 + 4] = p.strength;
    });

    const pathData = new Float32Array((steps + 1) * 4);
    for (let i = 0; i <= steps; i++) {
      pathData[i * 4 + 0] = px[i];
      pathData[i * 4 + 1] = py[i];
      pathData[i * 4 + 2] = pe[i];
      pathData[i * 4 + 3] = pa[i];
    }

    const sysPosData = new Float32Array(sysLength * 4);
    for (let j = 0; j < sysLength; j++) {
      sysPosData[j * 4 + 0] = this.system.posX[j];
      sysPosData[j * 4 + 1] = this.system.posY[j];
      sysPosData[j * 4 + 2] = this.system.posZ[j];
      sysPosData[j * 4 + 3] = this.system.posW[j];
    }

    const createB = (data: any, size: number, usage: number) => {
      const b = device.createBuffer({ size, usage });
      if (data) device.queue.writeBuffer(b, 0, data);
      return b;
    };

    const bPath = createB(
      pathData,
      pathData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST
    );
    const bSysPos = createB(
      sysPosData,
      sysPosData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    const bSysInfluence = createB(
      sysInfluence,
      sysInfluence.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    const bSysSlotType = createB(
      sysSlotType,
      sysSlotType.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    const bPenalties = createB(
      penaltyData,
      penaltyData.byteLength,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );

    const phys = DOPAT_CONFIG.PHYSICS;
    const params = new ArrayBuffer(64);
    const view = new DataView(params);
    view.setUint32(0, steps, true);
    view.setUint32(4, sysLength, true);
    view.setFloat32(8, learningRate, true);
    view.setUint32(12, penalties.length, true);
    view.setUint32(16, maxIterations, true);
    view.setFloat32(20, phys.GRADIENT_STEP, true);
    view.setFloat32(24, phys.INFLUENCE_RADIUS, true);
    view.setFloat32(28, phys.INFLUENCE_FALLOFF, true);
    view.setFloat32(32, phys.PENALTY_RADIUS, true);
    view.setFloat32(36, phys.PENALTY_FALLOFF, true);
    view.setFloat32(40, phys.BODY_SLOT_ATTRACTION, true);
    view.setFloat32(44, phys.COND_SLOT_ATTRACTION, true);
    view.setFloat32(48, phys.PHI_TEMPORAL_DECAY, true);
    view.setUint32(52, phys.CONFORMAL_ENABLED ? 1 : 0, true);
    view.setFloat32(56, phys.PHI_MAX, true);

    const bParams = createB(
      params,
      64,
      GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    );
    const bReadPath = createB(
      undefined,
      pathData.byteLength,
      GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    );

    const bg = device.createBindGroup({
      layout: this.geodesicPipeline!.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: bPath } },
        { binding: 1, resource: { buffer: bSysPos } },
        { binding: 2, resource: { buffer: bSysInfluence } },
        { binding: 3, resource: { buffer: bPenalties } },
        { binding: 4, resource: { buffer: bParams } },
        { binding: 5, resource: { buffer: bSysSlotType } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.geodesicPipeline!);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(bPath, 0, bReadPath, 0, pathData.byteLength);
    device.queue.submit([encoder.finish()]);

    await bReadPath.mapAsync(GPUMapMode.READ);
    const resPath = new Float32Array(bReadPath.getMappedRange().slice(0));
    bReadPath.unmap();

    for (let i = 0; i <= steps; i++) {
      px[i] = resPath[i * 4];
      py[i] = resPath[i * 4 + 1];
      pe[i] = resPath[i * 4 + 2];
      pa[i] = resPath[i * 4 + 3];
    }
    [
      bPath,
      bSysPos,
      bSysInfluence,
      bSysSlotType,
      bPenalties,
      bParams,
      bReadPath,
    ].forEach(b => b.destroy());
  }

  private async initGPUPipeline(): Promise<void> {
    const device = await TensorMath_GPU.getDevice();
    const geodesicShader = device.createShaderModule({
      code: `
        @group(0) @binding(0) var<storage, read_write> pathData: array<vec4<f32>>;
        @group(0) @binding(1) var<storage, read> sysPos: array<vec4<f32>>;
        @group(0) @binding(2) var<storage, read> sysInfluence: array<f32>;
        struct Penalty { pos: vec4<f32>, strength: f32, _p1: f32, _p2: f32, _p3: f32 };
        @group(0) @binding(3) var<storage, read> penalties: array<Penalty>;
        struct Params { steps: u32, sysLength: u32, lr: f32, penCount: u32, iter: u32, h: f32, iR: f32, iF: f32, pR: f32, pF: f32, bodyAttr: f32, condAttr: f32, temporalDecay: f32, conformalEnabled: u32, phiMax: f32, _pad: u32 };
        @group(0) @binding(4) var<uniform> params: Params;
        @group(0) @binding(5) var<storage, read> sysSlotType: array<u32>;
        ${CURVATURE_WGSL}

        const SLOT_BODY: u32      = 2u;
        const SLOT_CONDITION: u32 = 4u;

        struct MetricForceResult { V: f32, fx: f32, fy: f32, fz: f32, fw: f32 };

        fn getMetricForceAt(p: vec4<f32>) -> MetricForceResult {
            var V = 1.0; var fx = 0.0; var fy = 0.0; var fz = 0.0; var fw = 0.0;
            let F = params.iF;

            // First pass: compute local semantic density sum phi(p)
            var phi = 0.0;
            for (var j = 0u; j < params.sysLength; j = j + 1u) {
                let diff = p - sysPos[j];
                let distSq = dot(diff, diff);
                if (distSq >= params.iR) { continue; }
                let infl_j = sysInfluence[j];
                phi = phi + infl_j * exp(-distSq / F);
            }
            phi = min(phi, params.phiMax);

            // Second pass: compute potential V and metric forces
            for (var j = 0u; j < params.sysLength; j = j + 1u) {
                let diff = p - sysPos[j];
                let distSq = dot(diff, diff);
                if (distSq >= params.iR) { continue; }
                var infl = sysInfluence[j];
                let st = sysSlotType[j];
                if ((st & SLOT_BODY) != 0u)      { infl = infl + params.bodyAttr; }
                if ((st & SLOT_CONDITION) != 0u)  { infl = infl + params.condAttr; }

                // Smooth temporal suppression (A1): replaces hard 0.01 cutoff
                let dw_sup = max(0.0, p.w - sysPos[j].w);
                infl = infl * exp(-params.temporalDecay * dw_sup);

                // Conformal correction e^{-2φ} (A1 simplified, φ treated as constant)
                if (params.conformalEnabled != 0u) { infl = infl * exp(-2.0 * phi); }

                let e = infl * exp(-distSq / F);
                V = V - e;
                let f = 2.0 * e / F;
                fx = fx + f * diff.x; fy = fy + f * diff.y;
                fz = fz + f * diff.z; fw = fw + f * diff.w;
            }
            for (var k = 0u; k < params.penCount; k = k + 1u) {
                let diff = p - penalties[k].pos;
                let distSq = dot(diff, diff);
                if (distSq >= params.pR) { continue; }
                let e = penalties[k].strength * exp(-distSq / params.pF);
                V = V + e;
                let f = -2.0 * e / params.pF;
                fx = fx + f * diff.x; fy = fy + f * diff.y;
                fz = fz + f * diff.z; fw = fw + f * diff.w;
            }
            V = max(0.01, V);
            return MetricForceResult(V, fx, fy, fz, fw);
        }

        @compute @workgroup_size(64)
        fn main(@builtin(global_invocation_id) id: vec3<u32>) {
            let i = id.x;
            for (var it = 0u; it < params.iter; it = it + 1u) {
                if (i > 0u && i < params.steps) {
                    let curr = pathData[i];
                    let gr = getMetricForceAt(curr);
                    let force = vec4<f32>(gr.fx, gr.fy, gr.fz, gr.fw);
                    let spring = (pathData[i-1u] + pathData[i+1u])/2.0 - curr;
                    let displacement = params.lr * (spring * 2.0 - force);

                    var next = curr + displacement;
                    let ageDiff = next.w - pathData[i-1u].w;
                    if (ageDiff < 0.0) { next.w = next.w - ageDiff * 0.9; }
                    pathData[i] = next;
                }
                storageBarrier();
            }
        }
      `,
    });
    this.geodesicPipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: geodesicShader, entryPoint: "main" },
    });
  }

  private buildGridIndex(): void {
    this.gridIndex.clear();
    const n = this.system.length;
    for (let j = 0; j < n; j++) {
      this.gridIndex.insert(
        j,
        this.system.posX[j],
        this.system.posY[j],
        this.system.posZ[j],
        this.system.posW[j]
      );
    }
  }

  private relaxPath(
    px: Float64Array,
    py: Float64Array,
    pe: Float64Array,
    pa: Float64Array,
    steps: number,
    maxIterations: number,
    lr: number,
    boost: Set<number> | undefined,
    penalties: any[],
    activeAtoms?: Set<number>
  ): void {
    for (let iter = 0; iter < maxIterations; iter++) {
      for (let i = 1; i < steps; i++) {
        const [, fx, fy, fz, fw] = this.getMetricForce(
          px[i],
          py[i],
          pe[i],
          pa[i],
          penalties,
          boost,
          activeAtoms
        );

        const sx = (px[i - 1] + px[i + 1]) / 2 - px[i];
        const sy = (py[i - 1] + py[i + 1]) / 2 - py[i];
        const se = (pe[i - 1] + pe[i + 1]) / 2 - pe[i];
        const sa = (pa[i - 1] + pa[i + 1]) / 2 - pa[i];

        // C4: add Christoffel correction using local step velocity.
        const [cfx, cfy, cfz, cfw] = this._christoffelForce(
          px[i] - px[i - 1],
          py[i] - py[i - 1],
          pe[i] - pe[i - 1],
          pa[i] - pa[i - 1]
        );

        px[i] += lr * (sx * 2.0 - fx - cfx);
        py[i] += lr * (sy * 2.0 - fy - cfy);
        pe[i] += lr * (se * 2.0 - fz - cfz);

        const da_move = lr * (sa * 2.0 - fw - cfw);
        pa[i] += da_move;

        const ageDiff = pa[i] - pa[i - 1];
        if (ageDiff < 0) pa[i] -= ageDiff * 0.9;
        if (i < steps) {
          const nextAgeDiff = pa[i + 1] - pa[i];
          if (nextAgeDiff < 0) pa[i] += nextAgeDiff * 0.9;
        }
      }
    }

    // C4: Record mean unit velocity of the final relaxed path for training.
    let tvx = 0,
      tvy = 0,
      tvz = 0,
      tvw = 0;
    for (let i = 1; i <= steps; i++) {
      tvx += px[i] - px[i - 1];
      tvy += py[i] - py[i - 1];
      tvz += pe[i] - pe[i - 1];
      tvw += pa[i] - pa[i - 1];
    }
    const vMag =
      Math.sqrt(tvx * tvx + tvy * tvy + tvz * tvz + tvw * tvw) + 1e-12;
    this._lastPathVelocity = [tvx / vMag, tvy / vMag, tvz / vMag, tvw / vMag];
  }

  /**
   * Computes the metric potential V and the spatial metric force (fx, fy, fz, fw).
   *
   * In the ModPAT differential geometry paradigm:
   *   - Space has a conformal metric: g_ij = \Phi(p) * \delta_ij
   *   - The conformal factor is \Phi(p) = V_0 - V(p), where V_0 = 1.0 (vacuum potential)
   *     and V(p) is the potential computed here.
   *   - \Phi(p) = \sum e_j, which directly encodes local semantic density/influence.
   *   - The spatial force vector (fx, fy, fz, fw) is the gradient of the potential,
   *     driving path relaxation towards semantic density maxima.
   */
  private getMetricForce(
    px: number,
    py: number,
    pz: number,
    pw: number,
    pens: any[],
    boost: Set<number> | undefined,
    activeAtoms?: Set<number>
  ): [V: number, fx: number, fy: number, fz: number, fw: number] {
    const phys = DOPAT_CONFIG.PHYSICS;
    const F = phys.INFLUENCE_FALLOFF;
    let V = 1.0,
      fx = 0.0,
      fy = 0.0,
      fz = 0.0,
      fw = 0.0;

    const actualRadius = Math.sqrt(phys.INFLUENCE_RADIUS);
    const candidates = this.gridIndex.candidatesInRadius(
      px,
      py,
      pz,
      pw,
      actualRadius
    );

    // First pass: compute local semantic density sum φ(p)
    let phi = 0.0;
    for (const j of candidates) {
      // E0: skip atoms outside the active framework, if one is set
      if (activeAtoms !== undefined && !activeAtoms.has(j)) continue;
      const dx = px - this.system.posX[j],
        dy = py - this.system.posY[j],
        dz = pz - this.system.posZ[j],
        dw = pw - this.system.posW[j];
      const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
      if (d2 >= phys.INFLUENCE_RADIUS) continue;

      let infl_j =
        this.system.density[j] * 2.0 + this.system.intensity[j] * 1.5 + 5.0;
      if (boost?.has(this.system.scope[j])) infl_j += 50.0;
      const st = this.system.slotType[j];
      if (st & SlotType.Body) infl_j += phys.BODY_SLOT_ATTRACTION;
      if (st & SlotType.Condition) infl_j += phys.COND_SLOT_ATTRACTION;

      phi += infl_j * Math.exp(-d2 / F);
    }

    // P2: clamp φ to prevent numerical blow-up in e^{-2φ} at pathological densities
    if (phi > phys.PHI_MAX) {
      this.phiClippedCount++;
      phi = phys.PHI_MAX;
    }

    // Second pass: compute potential V and metric forces
    for (const j of candidates) {
      if (activeAtoms !== undefined && !activeAtoms.has(j)) continue;
      const dx = px - this.system.posX[j],
        dy = py - this.system.posY[j],
        dz = pz - this.system.posZ[j],
        dw = pw - this.system.posW[j];
      const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
      if (d2 >= phys.INFLUENCE_RADIUS) continue;

      let infl =
        this.system.density[j] * 2.0 + this.system.intensity[j] * 1.5 + 5.0;
      if (boost?.has(this.system.scope[j])) infl += 50.0;
      const st = this.system.slotType[j];
      if (st & SlotType.Body) infl += phys.BODY_SLOT_ATTRACTION;
      if (st & SlotType.Condition) infl += phys.COND_SLOT_ATTRACTION;

      // A1: smooth temporal suppression - composable multiplicative factor on top of
      // the conformal correction.  Replaces the hard 0.01 cutoff.
      // weight = exp(-PHI_TEMPORAL_DECAY × max(0, pw_probe − pw_atom))
      infl *= Math.exp(
        -phys.PHI_TEMPORAL_DECAY * Math.max(0, pw - this.system.posW[j])
      );

      // A1: conformal correction e^{-2φ}; simplified - φ treated as spatially constant
      // (inner derivative ∂φ/∂x omitted).  Valid for φ ≪ 1; see getMetricForceFullGradient
      // for the exact version.
      if (phys.CONFORMAL_ENABLED) infl *= Math.exp(-2.0 * phi);

      const e = infl * Math.exp(-d2 / F);
      V -= e;
      const f = (2.0 * e) / F;
      fx += f * dx;
      fy += f * dy;
      fz += f * dz;
      fw += f * dw;
    }

    if (pens) {
      const Fp = phys.PENALTY_FALLOFF;
      for (const p of pens) {
        const dx = px - p.x,
          dy = py - p.y,
          dz = pz - p.z,
          dw = pw - p.w;
        const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
        if (d2 >= phys.PENALTY_RADIUS) continue;
        const e = p.strength * Math.exp(-d2 / Fp);
        V += e;
        const f = (-2.0 * e) / Fp;
        fx += f * dx;
        fy += f * dy;
        fz += f * dz;
        fw += f * dw;
      }
    }

    if (phys.A_B_FULL_GRADIENT && phys.CONFORMAL_ENABLED) {
      // Correction: 2 × V_sum × ∇φ where V_sum = 1 − V (sum of all e_j).
      // ∇φ(p) = Σ_k infl_k × exp(−d²_k/F) × (−2/F) × (p − k)
      // force correction_i = 2 × V_sum × ∂φ/∂p_i
      const V_sum = 1.0 - Math.max(0.01, V); // clamp mirrors the return below
      let gpx = 0.0,
        gpy = 0.0,
        gpz = 0.0,
        gpw = 0.0;
      for (const j of candidates) {
        const dx = px - this.system.posX[j],
          dy = py - this.system.posY[j],
          dz = pz - this.system.posZ[j],
          dw = pw - this.system.posW[j];
        const d2 = dx * dx + dy * dy + dz * dz + dw * dw;
        if (d2 >= phys.INFLUENCE_RADIUS) continue;
        let infl_j =
          this.system.density[j] * 2.0 + this.system.intensity[j] * 1.5 + 5.0;
        if (boost?.has(this.system.scope[j])) infl_j += 50.0;
        const st = this.system.slotType[j];
        if (st & SlotType.Body) infl_j += phys.BODY_SLOT_ATTRACTION;
        if (st & SlotType.Condition) infl_j += phys.COND_SLOT_ATTRACTION;
        const ek = infl_j * Math.exp(-d2 / F);
        const gk = ek * (-2.0 / F);
        gpx += gk * dx;
        gpy += gk * dy;
        gpz += gk * dz;
        gpw += gk * dw;
      }
      fx += 2.0 * V_sum * gpx;
      fy += 2.0 * V_sum * gpy;
      fz += 2.0 * V_sum * gpz;
      fw += 2.0 * V_sum * gpw;
    }

    return [Math.max(0.01, V), fx, fy, fz, fw];
  }

  public getMetricForceWithInnerDerivative(
    px: number,
    py: number,
    pz: number,
    pw: number,
    pens: any[],
    boost: Set<number> | undefined,
    activeAtoms?: Set<number>
  ): [V: number, fx: number, fy: number, fz: number, fw: number] {
    const phys = DOPAT_CONFIG.PHYSICS;
    const oldGradient = phys.A_B_FULL_GRADIENT;
    const oldConformal = phys.CONFORMAL_ENABLED;

    // Temporarily set flags to true
    (phys as any).A_B_FULL_GRADIENT = true;
    (phys as any).CONFORMAL_ENABLED = true;

    try {
      return this.getMetricForce(px, py, pz, pw, pens, boost, activeAtoms);
    } finally {
      (phys as any).A_B_FULL_GRADIENT = oldGradient;
      (phys as any).CONFORMAL_ENABLED = oldConformal;
    }
  }

  /**
   * C4 - Compute the learned Christoffel correction force for one path step.
   *
   * The geodesic deviation from ΔΓᵢⱼᵏ is:
   *   f_correction_i = Σ_{j,k} ΔΓ_{ijk} · v_j · v_k
   *
   * where v is the local path velocity (step direction).
   */
  private _christoffelForce(
    vx: number,
    vy: number,
    vz: number,
    vw: number
  ): [fx: number, fy: number, fz: number, fw: number] {
    const v = [vx, vy, vz, vw];
    const f = [0, 0, 0, 0];
    const dG = this.deltaGamma;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const base = i * 16 + j * 4;
        for (let k = 0; k < 4; k++) {
          f[i] += dG[base + k] * v[j] * v[k];
        }
      }
    }
    return [f[0], f[1], f[2], f[3]];
  }

  /**
   * C4 - Update ΔΓᵢⱼᵏ using the last path's mean velocity direction.
   *
   * Positive scale reinforces (vault hit, successful challenge);
   * negative scale penalises (trap, contradiction).
   */
  private _updateChristoffels(scale: number): void {
    const [vx, vy, vz, vw] = this._lastPathVelocity;
    const v = [vx, vy, vz, vw];
    const lr = DOPAT_CONFIG.PHYSICS.CHRISTOFFEL_LR;
    const delta = lr * scale;
    const dG = this.deltaGamma;
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        const base = i * 16 + j * 4;
        for (let k = 0; k < 4; k++) {
          dG[base + k] += delta * v[i] * v[j] * v[k];
        }
      }
    }
  }

  /**
   * C4 - Decay ΔΓ toward zero (called from learnCycle).
   * Regularizes the learned correction so the prescribed metric always dominates.
   */
  public regularizeChristoffels(): void {
    const decay = 1.0 - DOPAT_CONFIG.PHYSICS.CHRISTOFFEL_REGULARIZATION;
    for (let i = 0; i < 64; i++) this.deltaGamma[i] *= decay;
  }

  /**
   * D2 – Parallel transport: compute the holonomy matrix from a relaxed path.
   *
   * At each step the tangent rotates in the plane (û_{i-1}, û_i).  The holonomy
   * H is the product of all these infinitesimal plane-rotations; it encodes how
   * much a vector carried along the path would be deflected from its initial
   * direction.  `lastInferentialEffort = ||H − I||_F / 4` is a scalar effort
   * signal: 0 for a straight geodesic, larger for a winding, curvature-rich path.
   */
  private _computeHolonomy(
    px: Float64Array,
    py: Float64Array,
    pe: Float64Array,
    pa: Float64Array,
    steps: number
  ): void {
    const H = this.lastHolonomy;
    // Reset to identity.
    H.fill(0);
    H[0] = H[5] = H[10] = H[15] = 1;

    const R = new Float64Array(16);

    for (let i = 1; i < steps; i++) {
      const ux = px[i] - px[i - 1];
      const uy = py[i] - py[i - 1];
      const uz = pe[i] - pe[i - 1];
      const uw = pa[i] - pa[i - 1];
      const vx = px[i + 1] - px[i];
      const vy = py[i + 1] - py[i];
      const vz = pe[i + 1] - pe[i];
      const vw = pa[i + 1] - pa[i];

      const uMag = Math.sqrt(ux * ux + uy * uy + uz * uz + uw * uw) + 1e-12;
      const vMag = Math.sqrt(vx * vx + vy * vy + vz * vz + vw * vw) + 1e-12;
      const ûx = ux / uMag,
        ûy = uy / uMag,
        ûz = uz / uMag,
        ûw = uw / uMag;
      const v̂x = vx / vMag,
        v̂y = vy / vMag,
        v̂z = vz / vMag,
        v̂w = vw / vMag;

      const cosT = Math.max(
        -1,
        Math.min(1, ûx * v̂x + ûy * v̂y + ûz * v̂z + ûw * v̂w)
      );
      if (Math.abs(cosT) > 1 - 1e-10) continue; // negligible bend, skip

      const sinT = Math.sqrt(1 - cosT * cosT);
      // v̂_perp: component of v̂ perpendicular to û, normalized.
      const px_ = (v̂x - cosT * ûx) / sinT;
      const py_ = (v̂y - cosT * ûy) / sinT;
      const pz_ = (v̂z - cosT * ûz) / sinT;
      const pw_ = (v̂w - cosT * ûw) / sinT;

      const û = [ûx, ûy, ûz, ûw];
      const p_ = [px_, py_, pz_, pw_];

      // Build rotation matrix R in the plane (û, v̂_perp):
      // R_ab = δ_ab + sinT(p_a û_b − û_a p_b) + (cosT−1)(û_a û_b + p_a p_b)
      for (let a = 0; a < 4; a++) {
        for (let b = 0; b < 4; b++) {
          R[a * 4 + b] =
            (a === b ? 1 : 0) +
            sinT * (p_[a] * û[b] - û[a] * p_[b]) +
            (cosT - 1) * (û[a] * û[b] + p_[a] * p_[b]);
        }
      }

      // H = R · H (compose new rotation onto accumulated holonomy).
      const h00 = H[0],
        h01 = H[1],
        h02 = H[2],
        h03 = H[3];
      const h10 = H[4],
        h11 = H[5],
        h12 = H[6],
        h13 = H[7];
      const h20 = H[8],
        h21 = H[9],
        h22 = H[10],
        h23 = H[11];
      const h30 = H[12],
        h31 = H[13],
        h32 = H[14],
        h33 = H[15];
      for (let a = 0; a < 4; a++) {
        H[a * 4 + 0] =
          R[a * 4] * h00 +
          R[a * 4 + 1] * h10 +
          R[a * 4 + 2] * h20 +
          R[a * 4 + 3] * h30;
        H[a * 4 + 1] =
          R[a * 4] * h01 +
          R[a * 4 + 1] * h11 +
          R[a * 4 + 2] * h21 +
          R[a * 4 + 3] * h31;
        H[a * 4 + 2] =
          R[a * 4] * h02 +
          R[a * 4 + 1] * h12 +
          R[a * 4 + 2] * h22 +
          R[a * 4 + 3] * h32;
        H[a * 4 + 3] =
          R[a * 4] * h03 +
          R[a * 4 + 1] * h13 +
          R[a * 4 + 2] * h23 +
          R[a * 4 + 3] * h33;
      }
    }

    // Inferential effort = ||H − I||_F / 4 (normalized so a 90° rotation → ~0.5).
    let frobSq = 0;
    for (let a = 0; a < 4; a++) {
      for (let b = 0; b < 4; b++) {
        const d = H[a * 4 + b] - (a === b ? 1 : 0);
        frobSq += d * d;
      }
    }
    this.lastInferentialEffort = Math.sqrt(frobSq) / 4;
  }

  /**
   * D3 – Detect whether two traversals between the same endpoints are homotopic.
   *
   * Constructs the loop path₁ ++ reversed(path₂) in (posX, posY) and checks
   * whether any H₁ generator atom is enclosed (non-zero winding number).
   * Straddled generators are genuine topological obstacles - the two routes
   * represent distinct inferential strategies, not paraphrases.
   *
   * @param minPersistence  Only H₁ bars with (death − birth) > this are checked.
   *   Filters out short-lived noise; defaults to 0 (check everything).
   */
  public detectHomotopy(
    pathA: Uint32Array,
    pathB: Uint32Array,
    h1Bars: PersistenceBar[],
    minPersistence = 0
  ): HomotopyResult {
    if (h1Bars.length === 0) {
      return { homotopic: true, straddledH1Bars: [], analogyScore: 0 };
    }

    // Build the loop in (posX, posY) = pathA forward + pathB reversed.
    const loop: [number, number][] = [];
    for (const id of pathA) {
      if (id < this.system.length && this.system.isAllocated(id)) {
        loop.push([this.system.posX[id], this.system.posY[id]]);
      }
    }
    for (let i = pathB.length - 1; i >= 0; i--) {
      const id = pathB[i];
      if (id < this.system.length && this.system.isAllocated(id)) {
        loop.push([this.system.posX[id], this.system.posY[id]]);
      }
    }
    if (loop.length < 3) {
      return { homotopic: true, straddledH1Bars: [], analogyScore: 0 };
    }

    const qualified = h1Bars.filter(b => b.death - b.birth > minPersistence);
    const straddled: PersistenceBar[] = [];

    for (const bar of qualified) {
      const id = bar.generatorAtomId;
      if (!this.system.isAllocated(id)) continue;
      const gx = this.system.posX[id];
      const gy = this.system.posY[id];
      if (windingNumber(loop, gx, gy) !== 0) {
        straddled.push(bar);
      }
    }

    const homotopic = straddled.length === 0;
    const analogyScore =
      qualified.length > 0 ? straddled.length / qualified.length : 0;
    return { homotopic, straddledH1Bars: straddled, analogyScore };
  }

  private getPotentialAndNearest(
    x: number,
    y: number,
    z: number,
    w: number,
    pens: any[],
    boost: Set<number> | undefined,
    activeAtoms?: Set<number>
  ): { potential: number; nearestId: number } {
    const phys = DOPAT_CONFIG.PHYSICS;
    const nearRadius = Math.sqrt(phys.INFLUENCE_RADIUS) * 4;
    const nearestId = this.gridIndex.nearest(
      x,
      y,
      z,
      w,
      nearRadius,
      this.system,
      activeAtoms
    );
    const [potential] = this.getMetricForce(
      x,
      y,
      z,
      w,
      pens,
      boost,
      activeAtoms
    );
    return { potential, nearestId };
  }

  private review(
    px: Float64Array,
    py: Float64Array,
    pe: Float64Array,
    pa: Float64Array,
    steps: number,
    activeAtoms?: Set<number>
  ): Mapping.ReviewReport {
    const phys = DOPAT_CONFIG.PHYSICS;
    const trapRadius = Math.sqrt(phys.TRAP_DISTANCE_THRESHOLD);
    for (let i = 1; i < steps; i++) {
      const nearestId = this.gridIndex.nearest(
        px[i],
        py[i],
        pe[i],
        pa[i],
        trapRadius,
        this.system,
        activeAtoms
      );
      if (nearestId === -1) continue;
      const ddx = px[i] - this.system.posX[nearestId];
      const ddy = py[i] - this.system.posY[nearestId];
      const ddz = pe[i] - this.system.posZ[nearestId];
      const ddw = pa[i] - this.system.posW[nearestId];
      const nearestDistSq = ddx * ddx + ddy * ddy + ddz * ddz + ddw * ddw;
      if (nearestDistSq < phys.TRAP_DISTANCE_THRESHOLD) {
        if (
          this.system.density[nearestId] > phys.TRAP_MASS_THRESHOLD &&
          this.system.entropyRate[nearestId] < phys.TRAP_ENTROPY_THRESHOLD
        ) {
          return { passed: false, reason: "Logic Trap detected", trapIndex: i };
        }
      }
    }
    return { passed: true };
  }

  private extractIds(
    px: Float64Array,
    py: Float64Array,
    pe: Float64Array,
    pa: Float64Array,
    steps: number,
    preExpandLength: number = 0,
    targetId: number = -1
  ): Uint32Array {
    const resultIds: number[] = [];
    const maxPosYByLayer = new Map<number, number>();

    for (let i = 0; i <= steps; i++) {
      let bestId = -1,
        minDiff = Infinity;

      const loopStart = preExpandLength > 0 ? preExpandLength : 0;

      const evalJ = (j: number): void => {
        const dx = this.system.posX[j] - px[i],
          dy = this.system.posY[j] - py[i],
          dz = this.system.posZ[j] - pe[i],
          dw = this.system.posW[j] - pa[i];
        const distSq = dx * dx + dy * dy + dz * dz + dw * dw;
        let totalDiff = distSq + dw * dw * 1000000.0;

        const layerJ = Math.floor(
          this.system.posZ[j] / DOPAT_CONFIG.structural.LAYER_BUCKET_SIZE
        );

        const maxPosY = maxPosYByLayer.get(layerJ) ?? -Infinity;
        if (this.system.posY[j] < maxPosY) {
          totalDiff += 1000000.0;
        }

        if (totalDiff < minDiff) {
          if (
            !(
              this.system.density[j] >
                DOPAT_CONFIG.PHYSICS.TRAP_MASS_THRESHOLD &&
              this.system.entropyRate[j] <
                DOPAT_CONFIG.PHYSICS.TRAP_ENTROPY_THRESHOLD
            )
          ) {
            minDiff = totalDiff;
            bestId = j;
          }
        }
      };

      for (let j = loopStart; j < this.system.length; j++) {
        evalJ(j);
      }

      if (targetId >= 0 && targetId < loopStart) {
        evalJ(targetId);
      }
      if (
        bestId !== -1 &&
        (resultIds.length === 0 || resultIds[resultIds.length - 1] !== bestId)
      ) {
        const layerBest = Math.floor(
          this.system.posZ[bestId] / DOPAT_CONFIG.structural.LAYER_BUCKET_SIZE
        );

        if (resultIds.length > 0) {
          const lastId = resultIds[resultIds.length - 1];
          const layerLast = Math.floor(
            this.system.posZ[lastId] / DOPAT_CONFIG.structural.LAYER_BUCKET_SIZE
          );

          if (layerLast === layerBest && bestId > lastId) {
            if (bestId - lastId < DOPAT_CONFIG.mapper.PATH_GAP_FILL_MAX) {
              for (let fillId = lastId + 1; fillId < bestId; fillId++) {
                resultIds.push(fillId);
              }
            }
          }
        }

        resultIds.push(bestId);

        const currentMax = maxPosYByLayer.get(layerBest) ?? -Infinity;
        if (this.system.posY[bestId] > currentMax) {
          maxPosYByLayer.set(layerBest, this.system.posY[bestId]);
        }
      }
    }
    return new Uint32Array(resultIds);
  }

  // =========================================================================
  // PERCEPTION (was Resolver.resolveSequence + helpers)
  // =========================================================================

  /** Probe mode: run physics only, skip vault and NLP rules. */
  public async probe(
    sequenceIds: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    return this.perceive(sequenceIds, { ...opts, probeMode: true });
  }

  /** Backward-compat alias. */
  public probeSequence(
    sequenceIds: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    return this.probe(sequenceIds, opts);
  }

  /**
   * Perception entry point.
   * When SETTLING_GRADIENT_ENABLED=true, routes through observeSettlingGradient
   * (Observe → Follow → Read).  Otherwise falls back to the Phase 0..7
   * transfer-matrix resonance pipeline via _perceiveCapturing.
   * The flag must only be flipped to true after the full test suite passes
   * without regressions (TRAVELER step 4).
   */
  public async perceive(
    sequenceIds: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    if (DOPAT_CONFIG.PHYSICS.SETTLING_GRADIENT_ENABLED) {
      return this.observeSettlingGradient(sequenceIds, opts);
    }
    return (await this._perceiveCapturing(sequenceIds, opts)).ids;
  }

  /** Backward-compat alias. */
  public resolveSequence(
    sequenceIds: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<Uint32Array> {
    return this.perceive(sequenceIds, opts);
  }

  /** Race-free diagnostics capture. */
  public async perceiveCapturing(
    sequenceIds: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<PerceptionCapture> {
    return this._perceiveCapturing(sequenceIds, opts);
  }

  /** Backward-compat alias. */
  public resolveSequenceCaptured(
    sequenceIds: Uint32Array,
    opts: PerceptionOptions = {}
  ): Promise<PerceptionCapture> {
    return this.perceiveCapturing(sequenceIds, opts);
  }

  private async _perceiveCapturing(
    sequenceIds: Uint32Array,
    opts: PerceptionOptions
  ): Promise<PerceptionCapture> {
    const N = sequenceIds.length;
    if (N === 0) {
      return {
        ids: new Uint32Array(0),
        diagnostics: null,
        sinkStrength: 0,
        discoveredOperators: [],
        bridgeCandidates: [],
      };
    }
    if (N > Traveler.MAX_SEQUENCE_LENGTH) {
      throw new Error(
        `Sequence length ${N} exceeds max DOD buffer capacity ${Traveler.MAX_SEQUENCE_LENGTH}`
      );
    }
    const slot = await this.workspacePool.acquire();
    slot.contextScopes = opts.contextScopes ?? this.contextScopes;
    slot.probeMode = opts.probeMode ?? false;
    try {
      const ids = await this._perceiveWithSlot(sequenceIds, slot);
      const capture: PerceptionCapture = {
        ids,
        diagnostics: slot.diagnostics,
        sinkStrength: slot.sinkStrength,
        discoveredOperators: slot.discoveredOperators,
        bridgeCandidates: slot.bridgeCandidates,
      };
      this.lastSinkStrength = capture.sinkStrength;
      this.lastDiagnostics = capture.diagnostics;
      this.lastDiscoveredOperators = capture.discoveredOperators;
      return capture;
    } finally {
      this.workspacePool.release(slot);
    }
  }

  private async _perceiveWithSlot(
    sequenceIds: Uint32Array,
    slot: TravelerWorkspace
  ): Promise<Uint32Array> {
    const N = sequenceIds.length;
    slot.sinkStrength = 0;
    slot.diagnostics = null;

    const lastId = sequenceIds[N - 1];
    const lastClass = this.system.operatorClass[lastId];

    let queryOpId = lastId;
    let queryOpClass = lastClass;
    let subjectIds = sequenceIds.slice(0, N - 1);

    if (lastClass === OperatorClass.Sink && N >= 3) {
      const prevId = sequenceIds[N - 2];
      const prevClass = this.system.operatorClass[prevId];
      if (prevClass === OperatorClass.IdentityShift) {
        queryOpId = prevId;
        queryOpClass = prevClass;
        subjectIds = sequenceIds.slice(0, N - 2);
      }
    }

    // Phase 0b: vault check first (crystallised knowledge, fast path + vault.hit accounting).
    // Must run before the topology walk so that previously-answered queries get a vault hit
    // rather than re-deriving via PartLayer every time (matches old Listener Phase 0 behaviour).
    const derivation = slot.probeMode
      ? null
      : await this.resolveSemanticDerivation(sequenceIds);
    if (derivation) return derivation;

    // Phase 0: topology walk (raw manifold inference from PartLayer chains).
    if (queryOpClass === OperatorClass.IdentityShift && subjectIds.length > 0) {
      const result = this.resolveMultiTokenSemanticLookup(
        subjectIds,
        queryOpId
      );

      logger.debug(
        `[DEBUG MAPPER] Phase 0 matched IDs: ${result.join(",")}, words: ${this.atomizer.decodeSequence(result, this.system)}`
      );

      if (result.length > 0) {
        if (!slot.probeMode && this.store) {
          await this.store.crystallizeProof(sequenceIds, result, 1.0);
          this.boostAtomMasses(sequenceIds);
          this.boostAtomMasses(result);
        }
        return result;
      }
    }

    // -- Phase 2: energy vibration init ----------------------------------------
    const energyVibration = slot.T_buffer.subarray(0, N);
    energyVibration.fill(0);
    if (N > 0) energyVibration[0] = 1.0;

    if (slot.contextScopes.size > 0) {
      const CONTEXT_WEIGHT = 0.35;
      for (let i = 1; i < N; i++) {
        if (slot.contextScopes.has(this.system.scope[sequenceIds[i]])) {
          energyVibration[i] = Math.max(energyVibration[i], CONTEXT_WEIGHT);
        }
      }
    }

    const ageWeight = DOPAT_CONFIG.resolver.AGE_ENERGY_WEIGHT;
    const sysAge = this.system.systemAge;
    for (let i = 0; i < N; i++) {
      const id = sequenceIds[i];
      let freshness: number;
      if (this.system.decayRate[id] === 0) {
        freshness = 1.0;
      } else {
        const staleness = Math.max(0, sysAge - this.system.posW[id]);
        freshness = Math.exp(-DOPAT_CONFIG.PHYSICS.AGE_DECAY_RATE * staleness);
      }
      if (freshness > 0.01) {
        energyVibration[i] = Math.min(
          1.0,
          energyVibration[i] + freshness * ageWeight
        );
      }
    }

    // -- Phase 3: transfer matrix construction ---------------------------------
    const transferMatrix = slot.W_buffer.subarray(0, N * N);
    transferMatrix.fill(0);

    let sinkNodeIdx = -1;

    for (let i = 0; i < N; i++) {
      const id = sequenceIds[i];
      const scope = this.system.scope[id];
      const opClass = this.system.operatorClass[id];

      if (opClass === OperatorClass.Sink) sinkNodeIdx = i;

      for (let j = 0; j < N; j++) {
        if (
          i !== j &&
          this.system.scope[sequenceIds[j]] === scope &&
          scope !== 0
        ) {
          transferMatrix[i * N + j] = Math.max(
            transferMatrix[i * N + j],
            DOPAT_CONFIG.resolver.W_CONSTRUCTIVE
          );
        }
      }

      if (i > 0 && i < N - 1) {
        if (
          opClass === OperatorClass.IdentityShift ||
          opClass === OperatorClass.Quantifier
        ) {
          const massRatio = Math.abs(this.system.mass[id]) / this.system.c ** 2;
          const lensStrength = massRatio * DOPAT_CONFIG.resolver.W_LENSING;
          transferMatrix[(i - 1) * N + (i + 1)] = lensStrength;
        } else if (opClass === OperatorClass.Inversion) {
          transferMatrix[i * N + (i + 1)] = DOPAT_CONFIG.resolver.W_DESTRUCTIVE;
        }
      }
    }
    // Modus tollens: "not B" cancels the B side of any "A implies B" bridge.
    for (let i = 0; i < N - 1; i++) {
      if (this.system.operatorClass[sequenceIds[i]] !== OperatorClass.Inversion)
        continue;
      if (this.system.operatorClass[sequenceIds[i + 1]] !== OperatorClass.None)
        continue;
      const negatedScope = this.system.scope[sequenceIds[i + 1]];
      for (let j = 1; j < N - 1; j++) {
        if (
          this.system.operatorClass[sequenceIds[j]] ===
            OperatorClass.IdentityShift &&
          j + 1 < N - 1
        ) {
          if (this.system.scope[sequenceIds[j + 1]] === negatedScope) {
            const bPos = j + 1;
            const aPos = j - 1;
            const backVal = -DOPAT_CONFIG.resolver.W_LENSING;
            if (transferMatrix[bPos * N + aPos] > backVal) {
              transferMatrix[bPos * N + aPos] = backVal;
            }
          }
        }
      }
    }

    const constructiveFloor = DOPAT_CONFIG.resolver.W_CONSTRUCTIVE / (N + 1);
    for (let i = 0; i < N; i++) {
      let rowSum = 0;
      for (let j = 0; j < N; j++) {
        rowSum += Math.abs(transferMatrix[i * N + j]);
      }
      if (rowSum > 0) {
        for (let j = 0; j < N; j++) {
          transferMatrix[i * N + j] /= rowSum;
        }
      }
      const scope_i = this.system.scope[sequenceIds[i]];
      if (scope_i !== 0) {
        for (let j = 0; j < N; j++) {
          if (i !== j && this.system.scope[sequenceIds[j]] === scope_i) {
            if (
              transferMatrix[i * N + j] > 0 &&
              transferMatrix[i * N + j] < constructiveFloor
            ) {
              transferMatrix[i * N + j] = constructiveFloor;
            }
          }
        }
      }
    }

    // -- Phase 4-5: forward resonance propagation ------------------------------
    const accumulatedResonance = slot.E_total_buffer.subarray(0, N * N);
    const currentResonance = slot.E_curr_buffer.subarray(0, N * N);
    accumulatedResonance.set(transferMatrix);
    currentResonance.set(transferMatrix);

    const logicalConductivity = DOPAT_CONFIG.resolver.PROPAGATION_ALPHA;

    if (this.gpu && N > 16) {
      for (
        let step = 1;
        step < DOPAT_CONFIG.resolver.PROPAGATION_ITERS;
        step++
      ) {
        const nextResonanceRes = await this.gpu.matMulF64(
          currentResonance,
          transferMatrix,
          N,
          N,
          N
        );
        const dampenedResonance = await this.gpu.mulScalarF64(
          nextResonanceRes,
          logicalConductivity
        );
        const totalResonanceRes = await this.gpu.addF64(
          accumulatedResonance,
          dampenedResonance
        );
        accumulatedResonance.set(totalResonanceRes);
        currentResonance.set(dampenedResonance);
      }
    } else {
      for (
        let step = 1;
        step < DOPAT_CONFIG.resolver.PROPAGATION_ITERS;
        step++
      ) {
        const nextResonance = slot.E_new_buffer.subarray(0, N * N);
        nextResonance.fill(0);
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            let sum = 0;
            for (let k = 0; k < N; k++) {
              sum += currentResonance[i * N + k] * transferMatrix[k * N + j];
            }
            const dampened = sum * logicalConductivity;
            nextResonance[i * N + j] = dampened;
            accumulatedResonance[i * N + j] += dampened;
          }
        }
        currentResonance.set(nextResonance);
      }
    }

    slot.discoveredOperators = this.discoverOperatorsByResonance(
      sequenceIds,
      N,
      accumulatedResonance
    );

    // -- Phase 6: backward energy from sink ------------------------------------
    const T_back = slot.T_back_buffer.subarray(0, N);
    const T_back_nx = slot.T_back_next_buffer.subarray(0, N);
    const backwardEnergy = slot.backwardEnergyBuffer.subarray(0, N);
    T_back.fill(0);
    T_back_nx.fill(0);
    backwardEnergy.fill(0);

    if (sinkNodeIdx !== -1) {
      T_back[sinkNodeIdx] = 1.0;
      backwardEnergy[sinkNodeIdx] = 1.0;

      for (
        let step = 0;
        step < DOPAT_CONFIG.resolver.PROPAGATION_ITERS;
        step++
      ) {
        T_back_nx.fill(0);
        for (let i = 0; i < N; i++) {
          let sum = 0;
          for (let j = 0; j < N; j++) {
            sum += transferMatrix[j * N + i] * T_back[j];
          }
          T_back_nx[i] = sum * logicalConductivity;
          backwardEnergy[i] += T_back_nx[i];
        }
        T_back.set(T_back_nx);
      }
    }

    // -- Bridge candidate detection ---------------------------------------------
    const bridgeCandidates: BridgeCandidate[] = [];
    const FWD_THRESHOLD = 0.05;
    const BACK_THRESHOLD = 0.05;

    for (let i = 0; i < N; i++) {
      if (this.system.operatorClass[sequenceIds[i]] !== OperatorClass.None)
        continue;

      let fwd = 0;
      for (let j = 0; j < N; j++) {
        if (j !== i) fwd += accumulatedResonance[j * N + i];
      }
      const bwd = backwardEnergy[i];
      const bridgeScore = fwd * bwd;
      const isMissingLink = bwd > BACK_THRESHOLD && fwd < FWD_THRESHOLD;

      if (bridgeScore > 0 || isMissingLink) {
        bridgeCandidates.push({
          idx: i,
          id: sequenceIds[i],
          label: this.atomizer
            .decodeSequence(new Uint32Array([sequenceIds[i]]), this.system)
            .trim(),
          forwardEnergy: fwd,
          backwardEnergy: bwd,
          bridgeScore,
          isMissingLink,
        });
      }
    }
    bridgeCandidates.sort((a, b) => b.bridgeScore - a.bridgeScore);

    if (sinkNodeIdx === -1) return sequenceIds;

    // -- Phase 7: sink candidate selection -------------------------------------
    let targetNodeIdx = -1;
    let maxNetEnergy = -Infinity;
    const allSinkCandidates: PerceptionDiagnostics["sinkCandidates"] = [];

    for (let j = 0; j < N; j++) {
      if (this.system.operatorClass[sequenceIds[j]] === OperatorClass.None) {
        let incomingEnergy = 0;
        let outboundEnergy = 0;
        for (let i = 0; i < N; i++) {
          if (i !== j) {
            incomingEnergy += accumulatedResonance[i * N + j];
            outboundEnergy += accumulatedResonance[j * N + i];
          }
        }

        const sinkStrength = incomingEnergy / (1.0 + outboundEnergy);
        if (sinkStrength > maxNetEnergy) {
          maxNetEnergy = sinkStrength;
          targetNodeIdx = j;
        }
        const id = sequenceIds[j];
        allSinkCandidates.push({
          idx: j,
          id,
          strength: sinkStrength,
          label: this.atomizer
            .decodeSequence(new Uint32Array([id]), this.system)
            .trim(),
          posX: this.system.posX[id],
          posY: this.system.posY[id],
          posZ: this.system.posZ[id],
          posW: this.system.posW[id],
          opClass: this.system.operatorClass[id],
        });
      }
    }

    slot.sinkStrength = Math.max(0, maxNetEnergy);
    slot.bridgeCandidates = bridgeCandidates;
    slot.diagnostics = {
      N,
      tokenLabels: Array.from(sequenceIds).map(id =>
        this.atomizer.decodeSequence(new Uint32Array([id]), this.system).trim()
      ),
      operatorClasses: Array.from(sequenceIds).map(
        id => this.system.operatorClass[id]
      ),
      W: new Float64Array(transferMatrix),
      accumulated: new Float64Array(accumulatedResonance),
      sinkCandidates: allSinkCandidates
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 5),
      selectedTargetIdx: targetNodeIdx,
      maxNetEnergy,
      discoveredOperators: slot.discoveredOperators,
      bridgeCandidates,
    };

    // Modus tollens result: pick the least-energised non-negated candidate.
    {
      const directlyNegatedScopes = new Set<number>();
      let inversionTokenId = -1;
      for (let i = 0; i < N - 1; i++) {
        if (
          this.system.operatorClass[sequenceIds[i]] ===
            OperatorClass.Inversion &&
          this.system.operatorClass[sequenceIds[i + 1]] === OperatorClass.None
        ) {
          directlyNegatedScopes.add(this.system.scope[sequenceIds[i + 1]]);
          if (inversionTokenId === -1) inversionTokenId = sequenceIds[i];
        }
      }
      if (inversionTokenId !== -1 && directlyNegatedScopes.size > 0) {
        let minStrength = -1e-9;
        let negatedConclusionId = -1;
        for (const c of allSinkCandidates) {
          const isDirectlyNegated = directlyNegatedScopes.has(
            this.system.scope[c.id]
          );
          if (!isDirectlyNegated && c.strength < minStrength) {
            minStrength = c.strength;
            negatedConclusionId = c.id;
          }
        }
        if (negatedConclusionId !== -1) {
          slot.sinkStrength = Math.abs(minStrength);
          return new Uint32Array([inversionTokenId, negatedConclusionId]);
        }
      }
    }

    if (maxNetEnergy <= 0) {
      const lastIdInSequence = sequenceIds[N - 1];
      if (this.system.operatorClass[lastIdInSequence] === OperatorClass.Sink) {
        return this.resolveCodeSynthesis(sequenceIds);
      }
      return this.atomizer.ingestSequence("unknown", this.system);
    }

    let sourceNodeIdx = -1;
    let directScopesCount = 0;
    const directScopes = slot.directScopesBuffer.subarray(0, N);

    for (let k = 0; k < N; k++) {
      if (transferMatrix[k * N + targetNodeIdx] > 0) {
        directScopes[directScopesCount++] = this.system.scope[sequenceIds[k]];
      }
    }

    const hasDirectScope = (scope: number) => {
      for (let i = 0; i < directScopesCount; i++) {
        if (directScopes[i] === scope) return true;
      }
      return false;
    };

    for (let i = 0; i < N; i++) {
      if (
        i !== targetNodeIdx &&
        this.system.operatorClass[sequenceIds[i]] === OperatorClass.None
      ) {
        if (
          accumulatedResonance[i * N + targetNodeIdx] > 0 &&
          transferMatrix[i * N + targetNodeIdx] === 0
        ) {
          if (!hasDirectScope(this.system.scope[sequenceIds[i]])) {
            sourceNodeIdx = i;
            break;
          }
        }
      }
    }

    let resultCount = 0;
    const resultIds = slot.resultIdsBuffer.subarray(0, N);

    const pushWithModifiers = (index: number) => {
      if (index > 0) {
        const leftId = sequenceIds[index - 1];
        if (this.system.operatorClass[leftId] === OperatorClass.Modifier) {
          resultIds[resultCount++] = leftId;
        }
      }
      const id = sequenceIds[index];
      if (this.system.operatorClass[id] !== OperatorClass.Sink) {
        resultIds[resultCount++] = id;
      }
    };

    if (sourceNodeIdx !== -1) {
      const originalOp = this.findDominantOperator(sequenceIds, sourceNodeIdx);
      pushWithModifiers(sourceNodeIdx);
      if (
        originalOp !== -1 &&
        this.system.operatorClass[originalOp] !== OperatorClass.Sink
      ) {
        resultIds[resultCount++] = originalOp;
      }
      pushWithModifiers(targetNodeIdx);
    } else {
      pushWithModifiers(targetNodeIdx);
    }

    const T_next = slot.T_next_buffer.subarray(0, N);
    for (let tick = 0; tick < N; tick++) {
      T_next.set(energyVibration);
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          const flow = transferMatrix[i * N + j];
          if (flow > 0) {
            T_next[j] += energyVibration[i] * flow;
          }
        }
      }
      energyVibration.set(T_next);
    }

    return new Uint32Array(resultIds.subarray(0, resultCount));
  }

  private async resolveCodeSynthesis(
    sequenceIds: Uint32Array
  ): Promise<Uint32Array> {
    if (!this.store)
      return this.atomizer.ingestSequence("unknown", this.system);

    const lastId = sequenceIds[sequenceIds.length - 1];
    const isSink = this.system.operatorClass[lastId] === OperatorClass.Sink;
    const lookupIds = isSink ? sequenceIds.slice(0, -1) : sequenceIds;

    const direct = await this.store.checkInterferencePattern(lookupIds);
    if (direct && direct.ids.length > 0) {
      const template = this.atomizer.decodeSequence(direct.ids, this.system);
      const contextTokens = Array.from(sequenceIds)
        .filter(id => {
          const cls = this.system.operatorClass[id];
          return (
            cls === OperatorClass.None ||
            cls === OperatorClass.Action ||
            cls === OperatorClass.Arithmetic
          );
        })
        .map(id =>
          this.atomizer
            .decodeSequence(new Uint32Array([id]), this.system)
            .trim()
        )
        .filter(t => t.length > 0);
      const varBindings = this.synthesizer.buildBindings(
        contextTokens,
        direct.slotFlags
      );
      const instantiated = this.synthesizer.instantiate(template, varBindings);
      if (instantiated && instantiated !== "unknown") {
        return this.atomizer.ingestSequence(instantiated, this.system);
      }
    }

    const attractors: { id: number; posZ: number }[] = [];
    for (let i = 0; i < this.system.length; i++) {
      if (!this.system.isAllocated(i)) continue;
      if (this.system.slotType[i] & (SlotType.Body | SlotType.Condition)) {
        attractors.push({ id: i, posZ: this.system.posZ[i] });
      }
    }
    attractors.sort((a, b) => b.posZ - a.posZ);

    const patterns: CodePattern[] = [];
    for (const { id } of attractors.slice(0, 6)) {
      const attrSeq = new Uint32Array([id]);
      const result = await this.store.checkInterferencePattern(attrSeq);
      if (result && result.ids.length > 0) {
        patterns.push({
          template: this.atomizer.decodeSequence(result.ids, this.system),
          slotFlags: result.slotFlags,
        });
      }
    }

    if (patterns.length > 0) {
      const composed = this.synthesizer.compose(patterns);
      const contextTokens = Array.from(sequenceIds)
        .map(id =>
          this.atomizer
            .decodeSequence(new Uint32Array([id]), this.system)
            .trim()
        )
        .filter(t => t.length > 0);
      const varBindings = this.synthesizer.buildBindings(
        contextTokens,
        patterns[0].slotFlags
      );
      const instantiated = this.synthesizer.instantiate(composed, varBindings);
      if (instantiated && instantiated !== "unknown") {
        return this.atomizer.ingestSequence(instantiated, this.system);
      }
    }

    return this.atomizer.ingestSequence("unknown", this.system);
  }

  // =========================================================================
  // COHERENT RESOLUTION (was Resolver.resolveCoherent)
  // =========================================================================

  public async perceiveCoherent(
    sequenceIds: Uint32Array,
    opts: {
      probeMode?: boolean;
      maxIterations?: number;
      contextScopes?: Set<number>;
    } = {}
  ): Promise<CoherentResult> {
    // TRAVELER step 4: settling gradient pipeline (Phase 0-7 retired).
    const ids = await this.observeSettlingGradient(sequenceIds, {
      contextScopes: opts.contextScopes,
      probeMode: opts.probeMode,
    });
    const coherence = Math.max(0, 1 - this.lastInferentialEffort);
    this._lastCoherentIds = ids;
    return {
      ids,
      coherence,
      iterations: 1,
      learned: [],
      diagnosis: ids.length > 0 ? "coherent" : "void",
      diagnostics: null,
    };
  }

  /** Backward-compat alias. */
  public resolveCoherent(
    sequenceIds: Uint32Array,
    opts: { probeMode?: boolean; maxIterations?: number } = {}
  ): Promise<CoherentResult> {
    return this.perceiveCoherent(sequenceIds, opts);
  }

  // =========================================================================
  // PERCEPTION HELPERS (Phase 3-7)
  // =========================================================================

  private discoverOperatorsByResonance(
    sequenceIds: Uint32Array,
    N: number,
    accumulated: Float64Array
  ): DiscoveredOperator[] {
    const cfg = DOPAT_CONFIG.resolver;
    const eps = this.system.epsilon;
    const discovered: DiscoveredOperator[] = [];

    for (let i = 0; i < N; i++) {
      const id = sequenceIds[i];
      if (this.system.operatorClass[id] !== OperatorClass.None) continue;

      let outbound = 0;
      let incoming = 0;
      for (let j = 0; j < N; j++) {
        if (j === i) continue;
        outbound += Math.abs(accumulated[i * N + j]);
        incoming += Math.abs(accumulated[j * N + i]);
      }

      const totalFlow = outbound + incoming;
      if (totalFlow < cfg.OPERATOR_DISCOVERY_MIN_FLOW) continue;

      const ratio = outbound / (totalFlow + eps);

      const rightNeighborClass =
        i < N - 1
          ? this.system.operatorClass[sequenceIds[i + 1]]
          : OperatorClass.None;
      if (
        rightNeighborClass === OperatorClass.IdentityShift ||
        rightNeighborClass === OperatorClass.Quantifier
      )
        continue;

      let inferredClass = OperatorClass.None;
      if (i > 0 && i < N - 1) {
        if (ratio >= cfg.OPERATOR_DISCOVERY_OUTBOUND_THRESHOLD) {
          inferredClass = OperatorClass.IdentityShift;
        } else if (ratio >= cfg.OPERATOR_DISCOVERY_CONJUNCTION_THRESHOLD) {
          inferredClass = OperatorClass.Conjunction;
        }
      }

      if (inferredClass === OperatorClass.None) continue;

      discovered.push({
        id,
        idx: i,
        label: this.atomizer
          .decodeSequence(new Uint32Array([id]), this.system)
          .trim(),
        inferredClass,
        confidence: ratio,
        outboundRatio: ratio,
      });
    }

    const CONFIRM_THRESHOLD = 3;
    const discoveredIds = new Set(discovered.map(d => d.id));

    for (const d of discovered) {
      if (d.confidence < cfg.OPERATOR_DISCOVERY_CONFIDENCE_THRESHOLD) continue;
      const ev = this.operatorEvidence.get(d.id);
      if (!ev || ev.cls !== d.inferredClass) {
        this.operatorEvidence.set(d.id, { cls: d.inferredClass, count: 1 });
      } else {
        ev.count++;
        if (ev.count >= CONFIRM_THRESHOLD) {
          this.system.operatorClass[d.id] = d.inferredClass;
          this.system.mass[d.id] = this.system.c ** 2;
          this.system.update(d.id, "operator_discovery");
          this.operatorEvidence.delete(d.id);
        }
      }
    }

    for (const [id, ev] of this.operatorEvidence) {
      if (!discoveredIds.has(id)) {
        ev.count--;
        if (ev.count <= 0) this.operatorEvidence.delete(id);
      }
    }

    return discovered;
  }

  private findDominantOperator(
    sequenceIds: Uint32Array,
    sourceNodeIdx?: number
  ): number {
    if (sourceNodeIdx !== undefined && sourceNodeIdx !== -1) {
      for (let i = sourceNodeIdx + 1; i < sequenceIds.length; i++) {
        const cls = this.system.operatorClass[sequenceIds[i]];
        if (cls === OperatorClass.IdentityShift) return sequenceIds[i];
        if (cls === OperatorClass.Conjunction || cls === OperatorClass.Sink)
          break;
      }
    }

    for (let i = sequenceIds.length - 1; i >= 0; i--) {
      const cls = this.system.operatorClass[sequenceIds[i]];
      if (cls === OperatorClass.IdentityShift) return sequenceIds[i];
    }
    return -1;
  }

  // =========================================================================
  // SEMANTIC LOOKUP (was Resolver private helpers)
  // =========================================================================

  private ensureSpatialIndex(): void {
    const n = this.system.length;
    if (n === this.lastIndexedLength) return;
    this.spatialIndex.clear();
    for (let j = 0; j < n; j++) {
      this.spatialIndex.insert(
        j,
        this.system.posX[j],
        this.system.posY[j],
        this.system.posZ[j],
        this.system.posW[j]
      );
    }
    this.lastIndexedLength = n;
  }

  private resolveMultiTokenSemanticLookup(
    subjectIds: Uint32Array,
    operatorId: number
  ): Uint32Array {
    if (subjectIds.length === 0) return new Uint32Array(0);

    const operatorScope = this.system.scope[operatorId];
    const operatorIdClass = this.system.operatorClass[operatorId];
    const length = this.system.length;

    const queryIdSet = new Set<number>(subjectIds);
    queryIdSet.add(operatorId);
    const ringEntries = this.system.getSequenceEntries();
    for (let r = ringEntries.length - 1; r >= 0; r--) {
      const { scope0, startId } = ringEntries[r];
      if (queryIdSet.has(startId)) continue;
      if (scope0 !== this.system.scope[subjectIds[0]]) continue;
      if (!this.system.isAllocated(startId)) continue;

      let match = true;
      for (let j = 0; j < subjectIds.length; j++) {
        const cId = startId + j;
        if (
          cId >= length ||
          !this.system.isAllocated(cId) ||
          this.system.scope[cId] !== this.system.scope[subjectIds[j]]
        ) {
          match = false;
          break;
        }
      }
      if (!match) continue;

      const opId = startId + subjectIds.length;
      if (opId < length && this.system.scope[opId] === operatorScope) {
        // Navigate via PartLayer (semantic chain), not sequential arithmetic.
        // Sequential +1 would incorrectly land on freshly-allocated IDs from
        // an unrelated ingestion that happens to follow this sequence in memory.
        const next = this.system.PartLayer[opId];
        if (next !== 0 && this.system.isAllocated(next)) {
          return this.collectSequence(next, 1);
        }
      }
    }

    const firstSubjectScope = this.system.scope[subjectIds[0]];
    const candidatesForScope = this.system.getIdsByScope(firstSubjectScope);

    for (const i of candidatesForScope) {
      if (queryIdSet.has(i)) continue;

      let match = true;
      let curr = i;
      for (let j = 0; j < subjectIds.length; j++) {
        if (
          curr === 0 ||
          !this.system.isAllocated(curr) ||
          this.system.scope[curr] !== this.system.scope[subjectIds[j]]
        ) {
          match = false;
          break;
        }
        if (j < subjectIds.length - 1) {
          curr = this.system.PartLayer[curr];
        }
      }
      if (!match) continue;

      const opId = this.system.PartLayer[curr];

      if (
        opId !== 0 &&
        this.system.isAllocated(opId) &&
        this.system.scope[opId] === operatorScope
      ) {
        return this.collectSequence(this.system.PartLayer[opId], 1);
      }
    }

    if (operatorIdClass === OperatorClass.IdentityShift) {
      for (const i of this.system.getIdsByScope(operatorScope)) {
        if (queryIdSet.has(i)) continue;

        let match = true;
        let curr = this.system.PartLayer[i];
        for (let j = 0; j < subjectIds.length; j++) {
          if (
            curr === 0 ||
            !this.system.isAllocated(curr) ||
            this.system.scope[curr] !== this.system.scope[subjectIds[j]]
          ) {
            match = false;
            break;
          }
          curr = this.system.PartLayer[curr];
        }
        if (match) {
          return this.collectSequence(this.system.ComplexLayer[i], -1);
        }
      }
    }

    let subX = 0,
      subY = 0,
      subZ = 0,
      subW = 0,
      subMass = 0;
    for (let i = 0; i < subjectIds.length; i++) {
      const id = subjectIds[i];
      const m = this.system.mass[id] || 1.0;
      subX += this.system.posX[id] * m;
      subY += this.system.posY[id] * m;
      subZ += this.system.posZ[id] * m;
      subW += this.system.posW[id] * m;
      subMass += m;
    }
    if (subMass > 0) {
      subX /= subMass;
      subY /= subMass;
      subZ /= subMass;
      subW /= subMass;
    }

    let variance = 0;
    for (let i = 0; i < subjectIds.length; i++) {
      const id = subjectIds[i];
      const dx = this.system.posX[id] - subX;
      const dy = this.system.posY[id] - subY;
      const dz = this.system.posZ[id] - subZ;
      const dw = this.system.posW[id] - subW;
      variance += dx * dx + dy * dy + dz * dz + dw * dw;
    }
    const dynamicThreshold = Math.max(5.0, variance * 2.0);

    this.ensureSpatialIndex();
    const searchRadius = Math.sqrt(dynamicThreshold);
    const candidates = this.spatialIndex.candidatesInRadius(
      subX,
      subY,
      subZ,
      subW,
      searchRadius
    );

    const results: { ids: Uint32Array; score: number }[] = [];
    for (const i of candidates) {
      if (queryIdSet.has(i)) continue;

      const opClass = this.system.operatorClass[i];

      if (
        opClass === operatorIdClass &&
        this.system.scope[i] === operatorScope
      ) {
        const memSub = this.getClusterCentroid(this.system.ComplexLayer[i], -1);
        if (memSub.count > 0) {
          const dx = memSub.x - subX;
          const dy = memSub.y - subY;
          const dz = memSub.z - subZ;
          const dw = memSub.w - subW;
          const distSq = dx * dx + dy * dy + dz * dz + dw * dw;

          if (distSq < dynamicThreshold) {
            results.push({
              ids: this.collectSequence(this.system.PartLayer[i], 1),
              score: distSq,
            });
          }
        }

        if (opClass === OperatorClass.IdentityShift) {
          const memObj = this.getClusterCentroid(this.system.PartLayer[i], 1);
          if (memObj.count > 0) {
            const dx = memObj.x - subX;
            const dy = memObj.y - subY;
            const dz = memObj.z - subZ;
            const dw = memObj.w - subW;
            const distSq = dx * dx + dy * dy + dz * dz + dw * dw;

            if (distSq < dynamicThreshold) {
              results.push({
                ids: this.collectSequence(this.system.ComplexLayer[i], -1),
                score: distSq * 0.1,
              });
            }
          }
        }
      }
    }

    if (results.length > 0) {
      results.sort((a, b) => a.score - b.score);
      return results[0].ids;
    }

    return new Uint32Array(0);
  }

  private getClusterCentroid(
    startId: number,
    direction: 1 | -1
  ): {
    x: number;
    y: number;
    z: number;
    w: number;
    totalMass: number;
    count: number;
  } {
    let x = 0,
      y = 0,
      z = 0,
      w = 0,
      totalMass = 0,
      count = 0;
    let k = startId;

    while (k !== 0 && this.system.isAllocated(k)) {
      if (this.system.operatorClass[k] !== OperatorClass.None) break;

      const m = this.system.mass[k] || 1.0;
      x += this.system.posX[k] * m;
      y += this.system.posY[k] * m;
      z += this.system.posZ[k] * m;
      w += this.system.posW[k] * m;
      totalMass += m;
      count++;

      k =
        direction === 1
          ? this.system.PartLayer[k]
          : this.system.ComplexLayer[k];
    }

    if (totalMass > 0) {
      x /= totalMass;
      y /= totalMass;
      z /= totalMass;
      w /= totalMass;
    }
    return { x, y, z, w, totalMass, count };
  }

  public collectSequence(startId: number, direction: 1 | -1): Uint32Array {
    const ids: number[] = [];
    let k = startId;

    while (k !== 0 && this.system.isAllocated(k)) {
      if (this.system.operatorClass[k] !== OperatorClass.None) break;

      if (direction === 1) {
        ids.push(k);
        k = this.system.PartLayer[k];
      } else {
        ids.unshift(k);
        k = this.system.ComplexLayer[k];
      }
    }
    return new Uint32Array(ids);
  }

  private getSymbolScope(symbol: string): number {
    return this.atomizer.getSymbolScope(symbol, false);
  }

  private memoryContains(
    subjectScope: number,
    operatorScope: number,
    objectScope: number
  ): boolean {
    const length = this.system.length;
    for (let i = 0; i < length - 2; i++) {
      if (
        this.system.scope[i] === subjectScope &&
        this.system.scope[i + 1] === operatorScope &&
        this.system.scope[i + 2] === objectScope
      ) {
        return true;
      }
    }
    return false;
  }

  private findVerbForSubjectObject(
    subjectScope: number,
    objectScope: number
  ): number {
    const length = this.system.length;
    for (let i = 0; i < length - 2; i++) {
      if (
        this.system.scope[i] === subjectScope &&
        this.system.scope[i + 2] === objectScope &&
        this.system.mass[i + 1] === this.system.c ** 2
      ) {
        return this.system.scope[i + 1];
      }
    }
    return -1;
  }

  private async resolveSemanticDerivation(
    sequenceIds: Uint32Array
  ): Promise<Uint32Array | null> {
    if (this.store) {
      const vaultHit = await this.store.checkInterferencePattern(sequenceIds);
      if (vaultHit && vaultHit.ids.length > 0) return vaultHit.ids;

      // Also try sink-appended form: assertions are crystallized as
      // [subject... op sink] → [object], so a query [subject... op] won't match
      // without the sink suffix.  Append the first available Sink precept and retry.
      const N = sequenceIds.length;
      const lastClass =
        N > 0
          ? this.system.operatorClass[sequenceIds[N - 1]]
          : OperatorClass.None;
      if (
        lastClass === OperatorClass.IdentityShift ||
        lastClass === OperatorClass.Action
      ) {
        const sinkScope = this.atomizer?.getSymbolScope("|-", false) ?? 0;
        if (sinkScope > 0) {
          const sinkId = [...this.system.getIdsByScope(sinkScope)].find(
            id =>
              this.system.isAllocated(id) &&
              this.system.operatorClass[id] === OperatorClass.Sink
          );
          if (sinkId !== undefined) {
            const probe = new Uint32Array([...sequenceIds, sinkId]);
            const sinkHit = await this.store.checkInterferencePattern(probe);
            if (sinkHit && sinkHit.ids.length > 0) return sinkHit.ids;
          }
        }
      }
    }

    const text = this.atomizer.decodeSequence(sequenceIds, this.system);
    const doc = nlp(text);

    const verbs = doc.verbs().out("array");
    const dates = doc.match("#Date").out("array");

    if (verbs.length > 0 && dates.length > 0) {
      const verb = verbs[0];
      const date = dates[0];

      const verbScope = this.getSymbolScope(verb);
      const impliesScope = this.getSymbolScope("implies");
      const creationScope = this.getSymbolScope("creation");

      if (this.memoryContains(verbScope, impliesScope, creationScope)) {
        const objectTokens = doc.match(`${verb} [*]`).out("array");
        if (objectTokens.length > 0) {
          const objectStr = objectTokens[0]
            .replace(verb, "")
            .replace(/\|-/g, "")
            .trim();
          if (objectStr) {
            const targetStr = `then ${objectStr} did not exist before ${date}`;
            return this.atomizer.ingestSequence(targetStr, this.system);
          }
        }
      } else {
        let subjectScope = -1,
          objectScope = -1,
          subjectStr = "",
          objectStr = "";
        for (let i = 0; i < sequenceIds.length - 2; i++) {
          if (this.system.scope[sequenceIds[i + 1]] === verbScope) {
            subjectScope = this.system.scope[sequenceIds[i]];
            objectScope = this.system.scope[sequenceIds[i + 2]];
            subjectStr = this.atomizer.decodeSequence(
              new Uint32Array([sequenceIds[i]]),
              this.system
            );
            objectStr = this.atomizer.decodeSequence(
              new Uint32Array([sequenceIds[i + 2]]),
              this.system
            );
            break;
          }
        }
        if (subjectScope !== -1 && objectScope !== -1) {
          const existingVerbScope = this.findVerbForSubjectObject(
            subjectScope,
            objectScope
          );
          if (existingVerbScope !== -1 && existingVerbScope !== verbScope) {
            if (
              this.memoryContains(
                existingVerbScope,
                impliesScope,
                creationScope
              )
            ) {
              const infVerb =
                nlp(verb).verbs().toInfinitive().out("array")[0] || verb;
              const targetStr = `then ${subjectStr} did not ${infVerb} ${objectStr}`;
              return this.atomizer.ingestSequence(targetStr, this.system);
            }
          }
        }
      }
    }
    return null;
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
        queryIds: ids,
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
        this.reinforcePath(new Uint32Array([0, ...ids, skillId, 0]));
      }

      // TRAVELER step 3: shadow comparison - run new gradient-following pipeline
      // alongside old pipeline and log Jaccard/cosine metrics for validation.
      if (
        DOPAT_CONFIG.PHYSICS.SETTLING_GRADIENT_SHADOW &&
        this._lastCoherentIds
      ) {
        const shadowOpts: PerceptionOptions = {
          contextScopes: this.language?.contextScopes(),
        };
        this.observeSettlingGradient(ids, shadowOpts)
          .then(shadowIds => {
            if (this._lastCoherentIds) {
              this._shadowCompare(
                this._lastCoherentIds,
                shadowIds,
                text.slice(0, 40)
              );
            }
          })
          .catch(() => {});
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
