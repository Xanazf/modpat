import nlp from "compromise";
import { DOPAT_CONFIG } from "@config";
import { TensorMath_GPU } from "@core_s/Math";
import type Store from "@core_s/Memory";
import type Unfolder from "@core_s/Unfolder";
import logger from "@utils/SpectralLogger";
import Mapper from "./Mapper";
import { Synthesizer, type CodePattern } from "./Coder";
import System, { OperatorClass, SlotType, SystemRef } from "./System";
import { GridIndex4D } from "../structural/GridIndex4D";

/**
 * Result returned by resolveCoherent: the best answer found, a coherence score,
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
  /** Number of resolveSequence passes executed. */
  iterations: number;
  /**
   * Human-readable log of actions taken during the convergence loop:
   * void expansions, conflict notes, reinforcement boosts.
   */
  learned: string[];
  /**
   * Why the loop stopped:
   *  - "coherent"  — score crossed COHERENCE_THRESHOLD (answer found)
   *  - "void"      — manifold lacks relevant topology; expansion attempted if available
   *  - "conflict"  — two competing answers with similar strength; ambiguous
   *  - "weak"      — one answer but weakly supported; reinforced and accepted
   *  - "exhausted" — max iterations reached without crossing threshold
   */
  diagnosis: "coherent" | "void" | "conflict" | "weak" | "exhausted";
}

/**
 * A token that sits at the intersection of the forward and backward resonance waves.
 *
 * Bridge candidates emerge naturally from bidirectional propagation:
 *  - High forwardEnergy  → reached from the premises
 *  - High backwardEnergy → needed to reach the goal (Sink)
 *  - High bridgeScore    → forward and backward waves meet here (inference bridge)
 *  - isMissingLink       → needed by goal but not yet supported by premises;
 *                          the system should ask about this token
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
  /** Manifold ID of the promoted token. */
  id: number;
  /** Index within the resolved sequence (0..N-1). */
  idx: number;
  /** Human-readable label decoded from the manifold. */
  label: string;
  /** Operator class inferred from the resonance signature. */
  inferredClass: OperatorClass;
  /** Confidence score in [0, 1]: higher outbound ratio → higher confidence. */
  confidence: number;
  /** Fraction of total flow leaving this node (outbound / (outbound + incoming)). */
  outboundRatio: number;
}

export interface ResolverDiagnostics {
  N: number;
  tokenLabels: string[];
  operatorClasses: number[];
  /** N×N transfer matrix (row-major, values post-normalisation). */
  W: Float64Array;
  /** N×N accumulated resonance matrix from Phase 3. */
  accumulated: Float64Array;
  /** Top-5 non-operator sink candidates, sorted by strength descending. */
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
  /** Operators discovered from wave resonance peaks during this resolution pass. */
  discoveredOperators: DiscoveredOperator[];
  /**
   * Bridge candidates from the bidirectional resonance pass, sorted by
   * bridgeScore descending.  Entries with isMissingLink=true are the tokens
   * that the goal needs but the current premises don't yet supply — they are
   * the natural targets for targeted inquiry.
   */
  bridgeCandidates: BridgeCandidate[];
}

/**
 * The Resolver is the primary logical engine, modeled as a physical simulation
 * of resonance propagation. It treats sequences of logical quanta as a closed
 * dynamical system where energy (resonance) vibrates through a manifold.
 */
export default class Resolver implements Resolution.Engine {
  /** Shared reference cell, swap fires on ManifoldLifecycle failover. */
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  /** The engine for transforming between text and quanta. */
  private atomizer: Atomic.Engine;
  /** Persistent storage for logical proofs. */
  private store: Store | null = null;
  /** GPU-accelerated tensor operations for high-density manifolds. */
  private gpu: TensorMath_GPU | null = null;
  /** Mapper for calculating geodesic paths through the manifold. */
  private mapper: Mapper;
  /** Synthesizer for collapsing logical paths into TypeScript code. */
  private synthesizer: Synthesizer;

  /** Maximum capacity for the pre-allocated resolution buffers. */
  private static MAX_SEQUENCE_LENGTH = 1024;
  /** T_buffer: Stores the current energy vibration (resonance) of each node. */
  private T_buffer: Float64Array;
  /** W_buffer: The Transfer Matrix defining resonance between nodes. */
  private W_buffer: Float64Array;
  /** Accumulated resonance (reachability) across all steps. */
  private E_total_buffer: Float64Array;
  /** Current resonance snapshot for iterative propagation. */
  private E_curr_buffer: Float64Array;
  /** Buffer for calculating the next state of the resonance matrix. */
  private E_new_buffer: Float64Array;
  /** Buffer for temporal vibration updates. */
  private T_next_buffer: Float64Array;
  /** Backward resonance energy vector — energy propagating from goal toward premises. */
  private T_back_buffer: Float64Array;
  /** Scratch buffer for the backward propagation step. */
  private T_back_next_buffer: Float64Array;
  /** Accumulated backward energy per node across all backward propagation steps. */
  private backwardEnergyBuffer: Float64Array;
  /** Temporary storage for identified direct logical scopes. */
  private directScopesBuffer: Float64Array;
  /** Result buffer for the final inferred quantum sequence. */
  private resultIdsBuffer: Uint32Array;
  /** 4D spatial index reused across fuzzy-centroid lookups; rebuilt when system length changes. */
  private readonly spatialIndex = new GridIndex4D();
  private lastIndexedLength = -1;

  /**
   * Evidence accumulator for operator discovery.
   * Maps precept ID → { class, count } so a token must appear as a candidate
   * across OPERATOR_DISCOVERY_CONFIRMATION_THRESHOLD queries before being
   * permanently promoted.  Single-query false positives never contaminate the manifold.
   */
  private operatorEvidence = new Map<
    number,
    { cls: OperatorClass; count: number }
  >();

  /** Sink strength of the winning target node from the most recent resolveSequence call. */
  public lastSinkStrength = 0;
  /** Full diagnostic snapshot from the most recent resolveSequence physics run. */
  public lastDiagnostics: ResolverDiagnostics | null = null;
  /** Operators discovered via resonance-peak analysis during the most recent resolveSequence call. */
  public lastDiscoveredOperators: DiscoveredOperator[] = [];
  /** When true, resolveSequence skips Phase 0 (vault) and Phase 1 (NLP derivation). */
  private probeMode = false;

  /**
   * Initializes the Resolver and pre-allocates scratchpad memory for DOD performance.
   *
   * @param system The logical manifold.
   * @param atomizer The quantum transformer.
   * @param store Optional persistent memory store.
   */
  constructor(
    system: Root.ManifoldView | SystemRef,
    atomizer: Atomic.Engine,
    store: Store | null = null
  ) {
    this.systemRef =
      system instanceof SystemRef ? system : new SystemRef(system);
    this.atomizer = atomizer;
    this.store = store;
    this.mapper = new Mapper(this.systemRef);
    this.synthesizer = new Synthesizer();

    const maxN = Resolver.MAX_SEQUENCE_LENGTH;
    this.T_buffer = new Float64Array(maxN);
    this.W_buffer = new Float64Array(maxN * maxN);
    this.E_total_buffer = new Float64Array(maxN * maxN);
    this.E_curr_buffer = new Float64Array(maxN * maxN);
    this.E_new_buffer = new Float64Array(maxN * maxN);
    this.T_next_buffer = new Float64Array(maxN);
    this.T_back_buffer = new Float64Array(maxN);
    this.T_back_next_buffer = new Float64Array(maxN);
    this.backwardEnergyBuffer = new Float64Array(maxN);
    this.directScopesBuffer = new Float64Array(maxN);
    this.resultIdsBuffer = new Uint32Array(maxN);

    // Initialize GPU offloading if configured.
    if (DOPAT_CONFIG.USE_GPU) {
      TensorMath_GPU.getDevice()
        .then(() => {
          this.gpu = new TensorMath_GPU();
          this.mapper.setGPU(this.gpu);
        })
        .catch(e => {
          console.warn(
            "GPU Acceleration failed to initialize, falling back to CPU:",
            e.message
          );
        });
    }
  }

  /**
   * Enables or disables GPU acceleration for intensive manifold calculations.
   *
   * @param enabled True to attempt GPU offloading.
   */
  public setGPUEnabled(enabled: boolean): void {
    if (enabled) {
      if (!this.gpu) {
        TensorMath_GPU.getDevice().then(() => {
          this.gpu = new TensorMath_GPU();
          this.mapper.setGPU(this.gpu);
        });
      }
    } else {
      this.gpu = null;
      this.mapper.setGPU(null);
    }
  }

  /**
   * Sets or updates the Unfolder engine used by the resolver's internal mapper
   * and by the resolver itself for automatic void expansion on weak results.
   *
   * @param unfolder The unfolder engine.
   */
  public setUnfolder(unfolder: Unfolder): void {
    this.unfolder = unfolder;
    this.mapper.setUnfolder(unfolder);
  }

  private unfolder: Unfolder | null = null;

  /**
   * Disposes of GPU resources and clean up the engine state.
   */
  /**
   * Called by Listener when a vault cache hit is found (Phase 0 now lives there).
   * Boosts masses and refreshes concept ages for both the input and output atoms,
   * maintaining the vault→physics feedback loop from inside the Resolver's context.
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
      // Refresh temporal freshness: this concept just participated in a proven
      // inference — it should stay warm in the forward-energy seeding.
      this.system.refreshConceptAge(this.system.scope[id]);
    }
  }

  public async dispose(): Promise<void> {
    if (this.gpu) {
      await this.gpu.dispose();
      this.gpu = null;
    }
  }

  /**
   * Runs the physics simulation (Phases 2–7) without consulting the vault (Phase 0)
   * or the NLP derivation rules (Phase 1). Used by Learner to test whether the
   * system can independently reproduce a result from manifold topology alone.
   *
   * @param sequenceIds The input sequence of quantum IDs (should end with a Sink token).
   * @returns The physics-derived conclusion sequence.
   */
  public async probeSequence(sequenceIds: Uint32Array): Promise<Uint32Array> {
    this.probeMode = true;
    try {
      return await this.resolveSequence(sequenceIds);
    } finally {
      this.probeMode = false;
    }
  }

  /**
   * Executes the physics simulation to resolve the logical conclusion.
   * This treats the sequence of quanta as a closed physical system where
   * logical flow is modeled as energy vibration (T) propagating through
   * a transfer matrix (W) of structural resonances.
   *
   * @param sequenceIds The input sequence of quantum IDs.
   * @returns The resolved sequence representing the conclusion.
   */
  /**
   * Optional set of scopes from working memory — any token in the current sequence
   * whose scope appears here gets a warm-start energy bonus in the forward pass,
   * making recently-established concepts naturally "louder" in the resonance.
   */
  public contextScopes: Set<number> = new Set();

  public async resolveSequence(sequenceIds: Uint32Array): Promise<Uint32Array> {
    const N = sequenceIds.length;
    if (N === 0) return new Uint32Array(0);
    this.lastSinkStrength = 0;
    this.lastDiagnostics = null;

    // Ensure sequence fits within our pre-allocated DOD scratchpad.
    if (N > Resolver.MAX_SEQUENCE_LENGTH) {
      throw new Error(
        `Sequence length ${N} exceeds max DOD buffer capacity ${Resolver.MAX_SEQUENCE_LENGTH}`
      );
    }

    // Phase 0: Handle semantic queries (e.g., "The sky is" or "The sky is |-").
    // These are open-ended questions that require lookup or memory resonance.
    const lastId = sequenceIds[N - 1];
    const lastClass = this.system.operatorClass[lastId];

    let queryOpId = lastId;
    let queryOpClass = lastClass;
    let subjectIds = sequenceIds.slice(0, N - 1);

    // If query ends in a Sink marker, look at the token before it for the intent.
    if (lastClass === OperatorClass.Sink && N >= 3) {
      const prevId = sequenceIds[N - 2];
      const prevClass = this.system.operatorClass[prevId];
      if (prevClass === OperatorClass.IdentityShift) {
        queryOpId = prevId;
        queryOpClass = prevClass;
        subjectIds = sequenceIds.slice(0, N - 2);
      }
    }

    if (queryOpClass === OperatorClass.IdentityShift && subjectIds.length > 0) {
      // Phase 0a (vault cache) was moved to Listener.processQuestion so the
      // Resolver stays a pure physics engine.  Listener calls reinforceVaultHit()
      // on a hit and returns early before reaching here.

      // Phase 0b: Manifold semantic lookup — always runs, even in probe mode.
      // This scans the live ingested token graph (scope index, ring buffer, fuzzy
      // centroid) and is precisely what "reproducing on my own" means: using
      // topology I built from facts I ingested, not a cached answer.
      const result = this.resolveMultiTokenSemanticLookup(
        subjectIds,
        queryOpId
      );

      logger.debug(
        `[DEBUG RESOLVER] Phase 0 matched IDs: ${result.join(",")}, words: ${this.atomizer.decodeSequence(result, this.system)}`
      );

      if (result.length > 0) {
        // Crystallize only in normal mode — probe mode is read-only.
        if (!this.probeMode && this.store) {
          await this.store.crystallizeProof(sequenceIds, result, 1.0);
          // Boost masses: a freshly derived and crystallized inference also
          // reinforces its atoms so the path becomes more prominent over time.
          this.boostAtomMasses(sequenceIds);
          this.boostAtomMasses(result);
        }
        return result;
      }
      // Empty result: fall through to Phase 1/2 physics so the wave simulation
      // gets a chance to derive the answer from the manifold topology.
    }

    // Phase 1: Semantic Derivation (NLP-based logic rules).
    const derivation = this.probeMode
      ? null
      : this.resolveSemanticDerivation(sequenceIds);
    if (derivation) return derivation;

    // Phase 2: Physics Simulation (Resolution Matrix).
    // Initialize the energy vibration vector.
    const energyVibration = this.T_buffer.subarray(0, N);
    energyVibration.fill(0);
    if (N > 0) energyVibration[0] = 1.0; // Seed the system with initial resonance energy.

    // Working-memory warm start: tokens whose scope appears in recent conclusions
    // get bonus energy so established context naturally amplifies in the forward wave.
    if (this.contextScopes.size > 0) {
      const CONTEXT_WEIGHT = 0.35;
      for (let i = 1; i < N; i++) {
        if (this.contextScopes.has(this.system.scope[sequenceIds[i]])) {
          energyVibration[i] = Math.max(energyVibration[i], CONTEXT_WEIGHT);
        }
      }
    }

    // Age-freshness bonus: concepts that were recently accessed (high posW) get
    // a head start in the forward wave.  This is the manifold-level equivalent of
    // working memory — concepts don't just stay warm for a few session turns, they
    // retain a decaying advantage until the Runtime tick fades them out.
    const ageWeight = DOPAT_CONFIG.resolver.AGE_ENERGY_WEIGHT;
    for (let i = 0; i < N; i++) {
      const freshness = this.system.posW[sequenceIds[i]];
      if (freshness > 0.01) {
        energyVibration[i] = Math.min(
          1.0,
          energyVibration[i] + freshness * ageWeight
        );
      }
    }

    // Initialize the Transfer Matrix (W) defining the conductivity of logic.
    const transferMatrix = this.W_buffer.subarray(0, N * N);
    transferMatrix.fill(0);

    let sinkNodeIdx = -1;

    // Build the Transfer Matrix based on structural resonance and operator behavior.
    for (let i = 0; i < N; i++) {
      const id = sequenceIds[i];
      const scope = this.system.scope[id];
      const opClass = this.system.operatorClass[id];
      logger.debug(
        `[DEBUG RESOLVER] Token ${i}: ${this.atomizer.decodeSequence(new Uint32Array([id]), this.system)}, opClass: ${opClass}, scope: ${scope}`
      );

      // Identify the Sink Node: the logical conclusion point.
      if (opClass === OperatorClass.Sink) sinkNodeIdx = i;

      // Constructive Interference: Tokens sharing the same scope (same symbol) attract energy.
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
          logger.debug(
            `[DEBUG RESOLVER] Constructive Interference between ${i} and ${j}`
          );
        }
      }

      // Gravitational Lenses: Identity shifts and quantifiers bend the logic path.
      // Lens strength is proportional to operator mass / c², so higher-mass operators
      // (e.g. future arithmetic '*' vs '+') naturally create stronger lenses — this is
      // the "wave direction / meta-heat-map": the wave bends harder at massive operators.
      if (i > 0 && i < N - 1) {
        if (
          opClass === OperatorClass.IdentityShift ||
          opClass === OperatorClass.Quantifier
        ) {
          const massRatio = Math.abs(this.system.mass[id]) / this.system.c ** 2;
          const lensStrength = massRatio * DOPAT_CONFIG.resolver.W_LENSING;
          transferMatrix[(i - 1) * N + (i + 1)] = lensStrength;
          logger.debug(
            `[DEBUG RESOLVER] Gravitational Lens at ${i} bypassing to ${i + 1}`
          );
        } else if (opClass === OperatorClass.Inversion) {
          // Phase Inversion: Negation causes destructive interference (-1.0).
          transferMatrix[i * N + (i + 1)] = DOPAT_CONFIG.resolver.W_DESTRUCTIVE;
        }
      }
    }

    // Anti-particle back-propagation through implications.
    //
    // When ¬B is present (Inversion at i, negated scope S at i+1), and there
    // is an implication A→B (IdentityShift at j with consequent scope S at j+1),
    // the destructive wave propagates BACKWARD through the lens:
    //   W[B_pos][A_pos] = −W_LENSING
    //
    // This models the anti-particle: ¬B flows through the A→B lens in reverse,
    // making A accumulate negative incoming energy.  The most-negatively-affected
    // non-directly-negated operand is the modus-tollens conclusion (¬A).
    //
    // ¬¬A does not match here because the second ¬ negates an operator token, not a
    // semantic one, so no IdentityShift consequent is found and no edge is written.
    {
      for (let i = 0; i < N - 1; i++) {
        if (
          this.system.operatorClass[sequenceIds[i]] !== OperatorClass.Inversion
        )
          continue;
        // Only consider semantic (non-operator) negated tokens: operators are part of
        // structural patterns (like ¬¬A) and must not trigger modus-tollens back-prop.
        if (
          this.system.operatorClass[sequenceIds[i + 1]] !== OperatorClass.None
        )
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
    }

    // Energy Conservation (Diffusion Matrix Normalization)
    // Ensures resonance energy does not magically multiply and explode the matrix.
    // After normalization, constructive-interference entries get a floor so tokens
    // with many same-scope matches don't get diluted into noise.  The floor is
    // W_CONSTRUCTIVE / (N + 1), ensuring at least one same-scope token keeps a
    // meaningful signal even in a dense sequence.
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
      // Floor: constructive entries must stay at least constructiveFloor.
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
    logger.debug(`[DEBUG RESOLVER] Sink Node Index: ${sinkNodeIdx}`);

    // Phase 3: Compute Accumulated Resonance Matrix (Reachability).
    // Iteratively propagate energy through the matrix to find long-range resonances.
    const accumulatedResonance = this.E_total_buffer.subarray(0, N * N);
    const currentResonance = this.E_curr_buffer.subarray(0, N * N);
    accumulatedResonance.set(transferMatrix);
    currentResonance.set(transferMatrix);

    const logicalConductivity = DOPAT_CONFIG.resolver.PROPAGATION_ALPHA; // Physical dissipation factor (Alpha)

    if (this.gpu && N > 16) {
      // GPU Acceleration for matrix power series (high-performance propagation).
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
        // Dampen energy using explicit physical dissipation model.
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
      // CPU Fallback for matrix propagation (O(N^3)).
      for (
        let step = 1;
        step < DOPAT_CONFIG.resolver.PROPAGATION_ITERS;
        step++
      ) {
        const nextResonance = this.E_new_buffer.subarray(0, N * N);
        nextResonance.fill(0);
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            let sum = 0;
            for (let k = 0; k < N; k++) {
              sum += currentResonance[i * N + k] * transferMatrix[k * N + j];
            }
            const dampened = sum * logicalConductivity; // Apply logical friction/entropy.
            nextResonance[i * N + j] = dampened;
            accumulatedResonance[i * N + j] += dampened;
          }
        }
        currentResonance.set(nextResonance);
      }
    }

    logger.debug(
      `[DEBUG RESOLVER] Energy Vibration Initial: ${Array.from(energyVibration)}`
    );
    logger.debug(
      `[DEBUG RESOLVER] Accumulated Resonance (first row): ${Array.from(accumulatedResonance.subarray(0, N))}`
    );

    // Phase 3.5: Operator Discovery via resonance-peak analysis.
    // Scan tokens still classified as None and check whether their resonance topology
    // (outbound vs incoming energy distribution) betrays operator-like behaviour.
    // Discoveries update operatorClass and mass in the manifold for future resolutions.
    this.lastDiscoveredOperators = this.discoverOperatorsByResonance(
      sequenceIds,
      N,
      accumulatedResonance
    );

    // Phase 3.6: Backward Resonance Pass — goal-directed propagation.
    //
    // Propagates energy backward from the Sink node through W^T (the transposed
    // transfer matrix).  W[i→j] in the forward direction becomes W^T[j→i] in the
    // backward direction: if i energises j forward, then j energises i backward.
    //
    // After both passes:
    //  forward_energy[i]  = how strongly the premises DRIVE token i
    //  backward_energy[i] = how strongly the goal REQUIRES token i
    //  bridge_score       = forward × backward (tokens where waves meet)
    //  missing_link       = high backward, low forward → needed but not yet supplied
    //
    // Missing links are the system's natural question targets: "to reach this
    // conclusion I need to understand X — can you help?"
    const T_back = this.T_back_buffer.subarray(0, N);
    const T_back_nx = this.T_back_next_buffer.subarray(0, N);
    const backwardEnergy = this.backwardEnergyBuffer.subarray(0, N);
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
            // W^T[i][j] = W[j][i]: backward energy at j flows to i via the forward edge j→i
            sum += transferMatrix[j * N + i] * T_back[j];
          }
          T_back_nx[i] = sum * logicalConductivity;
          backwardEnergy[i] += T_back_nx[i];
        }
        T_back.set(T_back_nx);
      }
    }

    // Compute per-node forward energy (total incoming from the accumulated forward matrix)
    // and build the bridge candidate list.
    const bridgeCandidates: BridgeCandidate[] = [];
    const FWD_THRESHOLD = 0.05; // below this: not reached by premises
    const BACK_THRESHOLD = 0.05; // above this: meaningfully required by goal

    for (let i = 0; i < N; i++) {
      if (this.system.operatorClass[sequenceIds[i]] !== OperatorClass.None)
        continue;

      let fwd = 0;
      for (let j = 0; j < N; j++) {
        if (j !== i) fwd += accumulatedResonance[j * N + i]; // incoming forward energy
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

    // If no explicit Sink node (|-) was provided, return the original sequence.
    if (sinkNodeIdx === -1) return sequenceIds;

    // Phase 4: Identify the Target Node (Sink point with highest net energy).
    let targetNodeIdx = -1;
    let maxNetEnergy = -Infinity;
    const allSinkCandidates: ResolverDiagnostics["sinkCandidates"] = [];

    for (let j = 0; j < N; j++) {
      // Look for a non-operator node that absorbed the most incoming logical energy.
      if (this.system.operatorClass[sequenceIds[j]] === OperatorClass.None) {
        let incomingEnergy = 0;
        let outboundEnergy = 0;
        for (let i = 0; i < N; i++) {
          if (i !== j) {
            incomingEnergy += accumulatedResonance[i * N + j];
            outboundEnergy += accumulatedResonance[j * N + i];
          }
        }

        // Sink Strength: High incoming energy with minimal outbound energy (a definitive conclusion).
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

    // Capture diagnostics for grounding tests and verbose mode.
    this.lastSinkStrength = Math.max(0, maxNetEnergy);
    this.lastDiagnostics = {
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
      discoveredOperators: this.lastDiscoveredOperators,
      bridgeCandidates,
    };

    logger.debug(
      `[DEBUG RESOLVER] Max Net Energy: ${maxNetEnergy}, Target Node Index: ${targetNodeIdx}`
    );

    // Negated-conclusion detection (modus tollens via back-propagated anti-particle wave).
    //
    // If back-propagation was active (at least one Inversion in the query), check whether
    // there is a non-directly-negated operand whose incoming energy has gone significantly
    // negative.  That operand is the inferred ¬A from A→B, ¬B ⊢ ¬A.
    //
    // Condition: the directly-negated operands (scope appears right after an Inversion) are
    // excluded — they are the *given* negation, not the *inferred* one.  The most-negatively-
    // affected remaining operand is the new inference.  We return [not_token, that_operand].
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
        let minStrength = -1e-9; // must be meaningfully negative (physics threshold, not scope)
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
          this.lastSinkStrength = Math.abs(minStrength);
          return new Uint32Array([inversionTokenId, negatedConclusionId]);
        }
      }
    }

    // If no stable conclusion resonated, handle Code Trigger or return "unknown".
    if (maxNetEnergy <= 0) {
      const lastIdInSequence = sequenceIds[N - 1];
      const isSink =
        this.system.operatorClass[lastIdInSequence] === OperatorClass.Sink;
      if (isSink) {
        return this.resolveCodeSynthesis(sequenceIds);
      }

      return this.atomizer.ingestSequence("unknown", this.system);
    }
    // Phase 5: Transitive Filtering.
    // Identify the indirect source that bridged the logical gap to the target.
    let sourceNodeIdx = -1;
    let directScopesCount = 0;
    const directScopes = this.directScopesBuffer.subarray(0, N);

    // Track scopes that already have a direct connection to the target.
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

    // Find a node that reached the target indirectly through the resonance matrix.
    for (let i = 0; i < N; i++) {
      if (
        i !== targetNodeIdx &&
        this.system.operatorClass[sequenceIds[i]] === OperatorClass.None
      ) {
        if (
          accumulatedResonance[i * N + targetNodeIdx] > 0 &&
          transferMatrix[i * N + targetNodeIdx] === 0
        ) {
          // If it reached the target indirectly and isn't part of the direct premise.
          if (!hasDirectScope(this.system.scope[sequenceIds[i]])) {
            sourceNodeIdx = i;
            break;
          }
        }
      }
    }

    // Phase 6: Construct the inferred output quanta.
    let resultCount = 0;
    const resultIds = this.resultIdsBuffer.subarray(0, N);

    // Helper to preserve logical modifiers (like "all", "every") in the output.
    const pushWithModifiers = (index: number) => {
      if (index > 0) {
        const leftId = sequenceIds[index - 1];
        if (this.system.operatorClass[leftId] === OperatorClass.Modifier) {
          resultIds[resultCount++] = leftId;
        }
      }
      const id = sequenceIds[index];
      // Skip the sink operator itself in the final output
      if (this.system.operatorClass[id] !== OperatorClass.Sink) {
        resultIds[resultCount++] = id;
      }
    };

    // Assemble the final conclusion (e.g. "Socrates is mortal").
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

    // Phase 7: Waveform Collapse (Simulated final state).
    // Collapses the vibrating system into its final discrete state.
    const T_next = this.T_next_buffer.subarray(0, N);
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

    const finalPath = new Uint32Array(resultIds.subarray(0, resultCount));

    return finalPath;
  }

  /**
   * Dedicated logic for physicalized code synthesis via sequential geodesic routing.
   */
  /**
   * Code synthesis via learned pattern retrieval and composition.
   *
   * Pipeline:
   *  1. Abstract the input sequence to get an intent signature.
   *  2. Query the Memory vault for a stored code pattern matching that intent.
   *  3. If a single direct match is found, use it.
   *  4. If no direct match, gather pattern attractors along a geodesic (precepts
   *     with SlotType.Body set, sorted outer→inner by posZ descending), retrieve
   *     their patterns, and compose.
   *  5. Instantiate the composed template with concrete tokens from the query context.
   *  6. Ingest the resulting code string back into the manifold and return its quanta.
   */
  private async resolveCodeSynthesis(
    sequenceIds: Uint32Array
  ): Promise<Uint32Array> {
    logger.debug(
      `[DEBUG RESOLVER] Code Synthesis: querying learned pattern vault...`
    );

    if (!this.store)
      return this.atomizer.ingestSequence("unknown", this.system);

    // 1. Direct vault query on the full intent sequence.
    const direct = await this.store.checkInterferencePattern(sequenceIds);
    if (direct && direct.ids.length > 0) {
      const template = this.atomizer.decodeSequence(direct.ids, this.system);
      const contextTokens = Array.from(sequenceIds)
        .filter(id => this.system.operatorClass[id] === OperatorClass.None)
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
      logger.debug(`[DEBUG RESOLVER] Direct pattern match: "${instantiated}"`);
      if (instantiated && instantiated !== "unknown") {
        return this.atomizer.ingestSequence(instantiated, this.system);
      }
    }

    // 2. Composite synthesis: find pattern attractors (Body-slotted precepts)
    //    in the manifold, sort outer→inner by posZ descending, retrieve each
    //    pattern from the vault, compose them.
    const attractors: { id: number; posZ: number }[] = [];
    for (let i = 0; i < this.system.length; i++) {
      if (!this.system.isAllocated(i)) continue;
      if (this.system.slotType[i] & (SlotType.Body | SlotType.Condition)) {
        attractors.push({ id: i, posZ: this.system.posZ[i] });
      }
    }
    // Sort outer→inner (higher posZ = outermost structure first).
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
      logger.debug(`[DEBUG RESOLVER] Composed pattern: "${instantiated}"`);
      if (instantiated && instantiated !== "unknown") {
        return this.atomizer.ingestSequence(instantiated, this.system);
      }
    }

    return this.atomizer.ingestSequence("unknown", this.system);
  }

  /**
   * Scans the accumulated resonance matrix for tokens still classified as
   * OperatorClass.None whose wave topology reveals operator-like behaviour.
   *
   * Operators are wave hubs: they distribute more energy than they absorb
   * (high outbound resonance ratio). Operands are sinks: energy converges
   * into them (low outbound ratio). Any None-class token sitting at a local
   * amplitude peak of outbound flow is a candidate for promotion.
   *
   * Tokens promoted above OPERATOR_DISCOVERY_CONFIDENCE_THRESHOLD have their
   * operatorClass and mass updated in the manifold so future geodesics and
   * resonance passes treat them as proper massive attractor bodies.
   *
   * @param sequenceIds The current resolution sequence.
   * @param N Length of the sequence.
   * @param accumulated N×N accumulated resonance matrix (row-major, Phase 3 output).
   * @returns All discovered operators (both below and above confidence threshold).
   */
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

      // Compute total outbound and incoming resonance for this node.
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

      // The lensing rule writes W[(lens-1)*N + (lens+1)] — a direct outbound edge
      // FROM the token to the LEFT of an IdentityShift/Quantifier.  That injects
      // outbound flow that has nothing to do with the token's own logical role, so
      // its outbound ratio is artificially inflated.  Skip it.
      const rightNeighborClass =
        i < N - 1
          ? this.system.operatorClass[sequenceIds[i + 1]]
          : OperatorClass.None;
      if (
        rightNeighborClass === OperatorClass.IdentityShift ||
        rightNeighborClass === OperatorClass.Quantifier
      )
        continue;

      // Classify by outbound ratio, restricted to interior positions.
      // Boundary tokens (i=0, i=N-1) are skipped: edge positions carry
      // start/end-of-sequence bias that inflates their outbound ratios artificially.
      let inferredClass = OperatorClass.None;
      if (i > 0 && i < N - 1) {
        if (ratio >= cfg.OPERATOR_DISCOVERY_OUTBOUND_THRESHOLD) {
          // Strongly routing — bridges two semantic clusters like "is", "causes",
          // "implies".  Classify as IdentityShift (the canonical bridge operator).
          inferredClass = OperatorClass.IdentityShift;
        } else if (ratio >= cfg.OPERATOR_DISCOVERY_CONJUNCTION_THRESHOLD) {
          // Balanced relay — connects concepts without strongly redirecting,
          // like "along with", "plus", "while".
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

    // Confidence accumulation: a token must appear as a candidate across
    // OPERATOR_DISCOVERY_CONFIRMATION_THRESHOLD distinct queries before being
    // permanently promoted.  This prevents single-query noise from contaminating
    // the manifold with spurious operator classifications.
    const CONFIRM_THRESHOLD = 3;
    const discoveredIds = new Set(discovered.map(d => d.id));

    for (const d of discovered) {
      if (d.confidence < cfg.OPERATOR_DISCOVERY_CONFIDENCE_THRESHOLD) continue;
      const ev = this.operatorEvidence.get(d.id);
      if (!ev || ev.cls !== d.inferredClass) {
        // New or reclassified candidate: reset count
        this.operatorEvidence.set(d.id, { cls: d.inferredClass, count: 1 });
      } else {
        ev.count++;
        if (ev.count >= CONFIRM_THRESHOLD) {
          // Confirmed across multiple queries — promote permanently.
          this.system.operatorClass[d.id] = d.inferredClass;
          this.system.mass[d.id] = this.system.c ** 2;
          this.system.update(d.id, "operator_discovery");
          this.operatorEvidence.delete(d.id); // no longer needs tracking
          logger.debug(
            `[OPERATOR DISCOVERY] confirmed "${d.label}" → ${OperatorClass[d.inferredClass]}` +
              ` after ${CONFIRM_THRESHOLD} observations`
          );
        }
      }
    }

    // Decay evidence for candidates NOT seen in this query (slow forgetting).
    for (const [id, ev] of this.operatorEvidence) {
      if (!discoveredIds.has(id)) {
        ev.count--;
        if (ev.count <= 0) this.operatorEvidence.delete(id);
      }
    }

    return discovered;
  }

  // Coherent Resolution Loop

  /**
   * Resolves a sequence by iterating until the wave collapses to a coherent
   * answer or the system learns from the attempt.
   *
   * Each iteration:
   *  1. Runs resolveSequence (or probeSequence in probe mode).
   *  2. Measures coherence = amplitude × contrast from lastDiagnostics.
   *  3. If coherence >= COHERENCE_THRESHOLD → returns the answer.
   *  4. Otherwise diagnoses WHY the wave didn't collapse:
   *       "void"     → no resonance; expand topic via Unfolder, retry.
   *       "conflict" → two equally strong sinks; note ambiguity, stop.
   *       "weak"     → one sink but under-energised; reinforce vault, accept.
   *  5. Accumulates a log of what actions were taken (the "learned" field).
   *
   * Callers that want intelligent resolution should prefer this over raw
   * resolveSequence.  probeMode=true skips vault cache AND void expansion
   * (probe mode tests manifold-only inference without external help).
   */
  public async resolveCoherent(
    sequenceIds: Uint32Array,
    opts: { probeMode?: boolean; maxIterations?: number } = {}
  ): Promise<CoherentResult> {
    const maxIter =
      opts.maxIterations ?? DOPAT_CONFIG.resolver.COHERENCE_MAX_ITERS;
    const threshold = DOPAT_CONFIG.resolver.COHERENCE_THRESHOLD;
    const contrastMin = DOPAT_CONFIG.resolver.COHERENCE_CONTRAST;
    const inProbe = opts.probeMode ?? false;

    const learned: string[] = [];
    let bestIds: Uint32Array = new Uint32Array(0);
    let bestCoherence = 0;
    let finalDiagnosis: CoherentResult["diagnosis"] = "exhausted";
    let iter = 0;

    for (; iter < maxIter; iter++) {
      // One resolution pass.
      const ids = inProbe
        ? await this.probeSequence(sequenceIds)
        : await this.resolveSequence(sequenceIds);

      const diag = this.lastDiagnostics;
      const coherence = this.measureCoherence(diag);

      if (coherence > bestCoherence) {
        bestCoherence = coherence;
        bestIds = ids;
      }

      // Converged?
      if (coherence >= threshold) {
        finalDiagnosis = "coherent";
        iter++;
        break;
      }

      if (!diag) {
        finalDiagnosis = "void";
        break;
      }

      // Diagnose and act.
      const dx = this.diagnoseLowCoherence(diag, contrastMin);

      if (dx === "void") {
        finalDiagnosis = "void";
        if (inProbe) break; // probe mode is read-only; no expansion
        const topic = this.extractContentWords(sequenceIds);
        if (!topic) break;

        // Route: known_word → already resolved above.
        //        unknown_word → dictionary first (fast, local, offline),
        //                       then Unfolder (Wikipedia/Context7) as fallback.
        let expanded = false;

        // The Unfolder tries its internal dictionary first, then Wikipedia.
        if (!expanded && this.unfolder) {
          const voidId = this.placeVoidAtCentroid(sequenceIds);
          logger.debug(
            `[COHERENCE] iter=${iter} void → unfolder expanding "${topic}"…`
          );
          const unfolded = await this.unfolder.expand(voidId, topic);
          if (unfolded) {
            expanded = true;
            learned.push(`expanded "${topic}"`);
          }
        }

        if (!expanded) break;
        // Continue: next iteration sees a richer manifold.
      } else if (dx === "conflict") {
        finalDiagnosis = "conflict";
        const a = diag.sinkCandidates[0]?.label ?? "?";
        const b = diag.sinkCandidates[1]?.label ?? "?";
        learned.push(`conflict: "${a}" vs "${b}"`);
        logger.debug(
          `[COHERENCE] iter=${iter} conflict between "${a}" and "${b}"`
        );
        break; // Cannot auto-resolve without user context.
      } else {
        // "weak" — one answer, under-energised.
        finalDiagnosis = "weak";
        if (!inProbe && this.store) {
          const { signature } = this.store.abstractSequence(sequenceIds);
          await this.store.adjustEnergy(signature, 0.2);
          const label = diag.sinkCandidates[0]?.label ?? "?";
          learned.push(`reinforced "${label}"`);
          logger.debug(`[COHERENCE] iter=${iter} weak → reinforced "${label}"`);
        }
        // Weak is still an answer; accept the best we have.
        break;
      }
    }

    // If we never got anything meaningful, fall back to "unknown".
    if (bestIds.length === 0) {
      bestIds = this.atomizer.ingestSequence("unknown", this.system);
    }

    return {
      ids: bestIds,
      coherence: bestCoherence,
      iterations: iter,
      learned,
      diagnosis: finalDiagnosis,
    };
  }

  /**
   * Coherence = amplitude × contrast, both in [0, 1].
   *
   * Amplitude captures how strongly the wave peaked at all (normalised sink
   * strength).  Contrast captures how unambiguous the winner is relative to the
   * runner-up.  Both must be high for the wave to be considered "collapsed".
   */
  private measureCoherence(diag: ResolverDiagnostics | null): number {
    if (!diag || diag.maxNetEnergy <= 0 || diag.sinkCandidates.length === 0)
      return 0;
    const best = diag.sinkCandidates[0].strength;
    if (best <= 0) return 0;
    // Amplitude: normalise via sigmoid so arbitrarily large values still sit in [0,1).
    const amplitude = diag.maxNetEnergy / (1 + diag.maxNetEnergy);
    // Contrast: fraction of combined top-2 energy belonging to the winner.
    const second = diag.sinkCandidates[1]?.strength ?? 0;
    const contrast = second <= 0 ? 1.0 : best / (best + second);
    return amplitude * contrast;
  }

  /** Returns "void", "conflict", or "weak" based on diagnostics. */
  private diagnoseLowCoherence(
    diag: ResolverDiagnostics,
    contrastMin: number
  ): "void" | "conflict" | "weak" {
    if (diag.maxNetEnergy <= 0 || diag.sinkCandidates.length === 0)
      return "void";
    const best = diag.sinkCandidates[0].strength;
    const second = diag.sinkCandidates[1]?.strength ?? 0;
    if (second > 0 && best / second < contrastMin) return "conflict";
    return "weak";
  }

  /** Decodes non-operator tokens in the sequence to a topic string. */
  private extractContentWords(sequenceIds: Uint32Array): string {
    const nonOpIds: number[] = [];
    for (let i = 0; i < sequenceIds.length; i++) {
      const id = sequenceIds[i];
      if (
        this.system.isAllocated(id) &&
        this.system.operatorClass[id] === OperatorClass.None
      )
        nonOpIds.push(id);
    }
    return this.atomizer
      .decodeSequence(new Uint32Array(nonOpIds), this.system)
      .trim();
  }

  /**
   * Creates a void precept at the 4D centroid of the query's content words.
   * The Unfolder anchors new knowledge near this point so it participates in
   * future resonance for the same concept.
   */
  private placeVoidAtCentroid(sequenceIds: Uint32Array): number {
    const nonOpIds: number[] = [];
    for (let i = 0; i < sequenceIds.length; i++) {
      const id = sequenceIds[i];
      if (
        this.system.isAllocated(id) &&
        this.system.operatorClass[id] === OperatorClass.None
      )
        nonOpIds.push(id);
    }
    let ax = 0,
      ay = 0,
      az = 0,
      aw = 0;
    for (const id of nonOpIds) {
      ax += this.system.posX[id];
      ay += this.system.posY[id];
      az += this.system.posZ[id];
      aw += this.system.posW[id];
    }
    const n = Math.max(1, nonOpIds.length);
    const voidScope = this.atomizer.getSymbolScope("void", false);
    const voidId = this.system.createLocation(-this.system.c, voidScope);
    this.system.posX[voidId] = ax / n;
    this.system.posY[voidId] = ay / n;
    this.system.posZ[voidId] = az / n;
    this.system.posW[voidId] = aw / n;
    this.system.update(voidId);
    return voidId;
  }

  /**
   * Helper to find the operator that bridged a transitive relationship.
   * Scans forward from the source node to find its immediate operator, ensuring grammatical agreement.
   * Falls back to scanning backward if no source node is provided.
   *
   * @param sequenceIds The quantum sequence.
   * @param sourceNodeIdx Optional index of the subject node to match its specific operator.
   */
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

  /**
   * Rebuilds the spatial index from current system state when the manifold has grown.
   * O(N) rebuild is amortised across O(1) lookups in the fuzzy centroid scan.
   */
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

  /**
   * Performs semantic lookup for a multi-token subject (e.g. 'the red planet').
   * Uses 4D distance (posX, posY, entropy, time) for fuzzy matching in the manifold.
   *
   * @param subjectIds The sequence of IDs representing the subject.
   * @param operatorId The ID of the operator (e.g., 'is').
   * @returns The resolved object quanta.
   */
  private resolveMultiTokenSemanticLookup(
    subjectIds: Uint32Array,
    operatorId: number
  ): Uint32Array {
    if (subjectIds.length === 0) return new Uint32Array(0);

    const operatorScope = this.system.scope[operatorId];
    const operatorIdClass = this.system.operatorClass[operatorId];
    const length = this.system.length;

    // 1. Ring fast-path: O(SEQUENCE_INDEX_SIZE) scan over recently ingested sequences.
    //    Iterates newest-first so recency bias aligns with thermodynamic forgetting,
    //    the most recently ingested (hottest) facts are checked first.
    //    Falls through to the full scan for facts older than the ring window.
    //
    //    IMPORTANT: setSequenceStart is called for every ingestSequence, including
    //    query sequences. Without the queryIdSet guard the fast-path would self-match
    //    the query's own ring entry and return collectSequence(past-end) → "".
    const queryIdSet = new Set<number>(subjectIds);
    queryIdSet.add(operatorId);
    const ringEntries = this.system.getSequenceEntries();
    for (let r = ringEntries.length - 1; r >= 0; r--) {
      const { scope0, startId } = ringEntries[r];
      if (queryIdSet.has(startId)) continue; // never match the current query's own entry
      if (scope0 !== this.system.scope[subjectIds[0]]) continue;
      if (!this.system.isAllocated(startId)) continue;

      // Verify every token in the subject sequence at consecutive memory positions
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

      // Check that the operator immediately follows the subject
      const opId = startId + subjectIds.length;
      if (opId < length && this.system.scope[opId] === operatorScope) {
        return this.collectSequence(opId + 1, 1);
      }
    }

    // 2. Scope-indexed scan: O(k) where k = occurrences of the first subject
    //    scope, replaces the previous O(N × M) full-manifold iteration.
    //
    // Forward Match: Inquiry Subject matches Memory Subject
    const firstSubjectScope = this.system.scope[subjectIds[0]];
    const candidatesForScope = this.system.getIdsByScope(firstSubjectScope);

    for (const i of candidatesForScope) {
      if (queryIdSet.has(i)) continue; // skip the query's own tokens

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

    // Backward Match: Inquiry Subject matches Memory Object (Identity Shift only).
    // Index on operatorScope to find operator positions in O(k).
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

    // 2. Fuzzy Centroid Match in 4D (Lower Precision fallback).
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

    // Calculate spatial variance to establish a dynamic logical boundary threshold
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

    // Spatial index: limit candidates to nodes within sqrt(dynamicThreshold) of the
    // subject centroid instead of scanning all N manifold nodes.
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
      // Skip tokens that are part of the input sequence (self-match prevention)
      if (queryIdSet.has(i)) continue;

      const opClass = this.system.operatorClass[i];

      if (
        opClass === operatorIdClass &&
        this.system.scope[i] === operatorScope
      ) {
        // Try Memory Subject Match
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

        // Try Memory Object Match (Identity Shift)
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
                score: distSq * 0.1, // Identity objects get priority
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

  /**
   * Helper to calculate the centroid of a contiguous cluster of non-operator tokens.
   * Stops at operator boundaries or Kind coordinate (posY) discontinuities.
   */
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

  /**
   * Helper to collect a contiguous sequence of non-operator tokens.
   * Stops at operator boundaries or Kind coordinate (posY) discontinuities.
   */
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

  /**
   * Executes a global memory scan when an incomplete vector is provided.
   * Uses both exact scope matching and fuzzy 4D semantic distance.
   *
   * @param subjectId The ID of the subject.
   * @param operatorId The ID of the operator.
   * @returns The resolved object quanta.
   */
  private resolveSemanticLookup(
    subjectId: number,
    operatorId: number
  ): Uint32Array {
    return this.resolveMultiTokenSemanticLookup(
      new Uint32Array([subjectId]),
      operatorId
    );
  }

  /**
   * Helper to retrieve the structural scope of a text symbol.
   */
  private getSymbolScope(symbol: string): number {
    return this.atomizer.getSymbolScope(symbol, false);
  }

  /**
   * Checks if a specific subject-operator-object triplet exists in the manifold.
   */
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

  /**
   * Scans memory for a verb that connects a specific subject and object.
   */
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

  /**
   * Attempts to derive abstract logical rules from semantic temporal inputs.
   * e.g., "Socrates was born in 470 BC" -> "then Socrates did not exist before 470 BC".
   *
   * @param sequenceIds The input quantum sequence.
   * @returns A derived sequence or null.
   */
  private resolveSemanticDerivation(
    sequenceIds: Uint32Array
  ): Uint32Array | null {
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

      // Check for structural rules related to creation/existence.
      if (this.memoryContains(verbScope, impliesScope, creationScope)) {
        const objectTokens = doc.match(`${verb} [*]`).out("array");
        if (objectTokens.length > 0) {
          const objectStr = objectTokens[0]
            .replace(verb, "")
            .replace(/\|-/g, "")
            .trim();
          if (objectStr) {
            // Determine if we should negate based on existing manifold knowledge
            const targetStr = `then ${objectStr} did not exist before ${date}`;
            return this.atomizer.ingestSequence(targetStr, this.system);
          }
        }
      } else {
        // Find existing connections in the manifold to derive contradictions or consequences.
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

  /**
   * Calculates a Geodesic Path in 4D (X, Y, Entropy, Time) between two concepts.
   *
   * @param startId The starting quantum ID.
   * @param endId The target quantum ID.
   * @param steps The number of steps for the path.
   * @param boostScopes Optional scopes to prioritize.
   * @returns A discrete sequence of quantum IDs representing the geodesic.
   */
  public async calculateGeodesic(
    startId: number,
    endId: number,
    steps: number = 32,
    boostScopes?: Set<number>,
    topic?: string,
    preExpandLength: number = 0
  ): Promise<Uint32Array> {
    return this.mapper.route(startId, endId, {
      steps,
      boostScopes,
      topic,
      preExpandLength,
    });
  }
}
