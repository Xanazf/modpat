import nlp from "compromise";
import { DOPAT_CONFIG } from "@config";
import { TensorMath_GPU } from "@core_s/Math";
import type Store from "@core_s/Memory";
import type Unfolder from "@core_s/Unfolder";
import logger from "@utils/SpectralLogger";
import Mapper from "./Mapper";
import Synthesizer from "./Synthesizer";
import System, { OperatorClass, SlotType, SystemRef } from "./System";
import { GridIndex4D } from "../structural/GridIndex4D";

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
}

/**
 * The Resolver is the primary logical engine, modeled as a physical simulation
 * of resonance propagation. It treats sequences of logical quanta as a closed
 * dynamical system where energy (resonance) vibrates through a manifold.
 */
export default class Resolver implements Resolution.Engine {
  /** Shared reference cell, swap fires on ManifoldManager failover. */
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
  /** Temporary storage for identified direct logical scopes. */
  private directScopesBuffer: Float64Array;
  /** Result buffer for the final inferred quantum sequence. */
  private resultIdsBuffer: Uint32Array;
  /** 4D spatial index reused across fuzzy-centroid lookups; rebuilt when system length changes. */
  private readonly spatialIndex = new GridIndex4D();
  private lastIndexedLength = -1;

  /** Sink strength of the winning target node from the most recent resolveSequence call. */
  public lastSinkStrength = 0;
  /** Full diagnostic snapshot from the most recent resolveSequence physics run. */
  public lastDiagnostics: ResolverDiagnostics | null = null;

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
   * Sets or updates the Unfolder engine used by the resolver's internal mapper.
   *
   * @param unfolder The unfolder engine.
   */
  public setUnfolder(unfolder: Unfolder): void {
    this.mapper.setUnfolder(unfolder);
  }

  /**
   * Disposes of GPU resources and clean up the engine state.
   */
  public async dispose(): Promise<void> {
    if (this.gpu) {
      await this.gpu.dispose();
      this.gpu = null;
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
      // Check if this logical interference pattern has already been crystallized.
      if (this.store) {
        const cached = await this.store.checkInterferencePattern(sequenceIds);
        if (cached && cached.ids.length > 0) {
          logger.debug(
            `[DEBUG RESOLVER] Phase 0 matched IDs (CACHED): ${cached.ids.join(",")}, words: ${this.atomizer.decodeSequence(cached.ids, this.system)}`
          );
          return cached.ids;
        }
      }

      // Perform a multi-token semantic lookup in the manifold.
      const result = this.resolveMultiTokenSemanticLookup(
        subjectIds,
        queryOpId
      );

      logger.debug(
        `[DEBUG RESOLVER] Phase 0 matched IDs: ${result.join(",")}, words: ${this.atomizer.decodeSequence(result, this.system)}`
      );

      // Crystallize the new proof into memory if a valid result was found.
      if (this.store && result.length > 0) {
        await this.store.crystallizeProof(sequenceIds, result, 1.0);
      }

      return result;
    }

    // Phase 1: Semantic Derivation (NLP-based logic rules).
    const derivation = this.resolveSemanticDerivation(sequenceIds);
    if (derivation) return derivation;

    // Phase 2: Physics Simulation (Resolution Matrix).
    // Initialize the energy vibration vector.
    const energyVibration = this.T_buffer.subarray(0, N);
    energyVibration.fill(0);
    if (N > 0) energyVibration[0] = 1.0; // Seed the system with initial resonance energy.

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

      // Constructive Interference: Tokens sharing the same scope (meaning) attract energy.
      for (let j = 0; j < N; j++) {
        if (
          i !== j &&
          Math.abs(this.system.scope[sequenceIds[j]] - scope) <
          DOPAT_CONFIG.resolver.SCOPE_EPSILON
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
      const eps = DOPAT_CONFIG.resolver.SCOPE_EPSILON;
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
            if (
              Math.abs(this.system.scope[sequenceIds[j + 1]] - negatedScope) <
              eps
            ) {
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
      const eps = DOPAT_CONFIG.resolver.SCOPE_EPSILON;
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
        let minStrength = -DOPAT_CONFIG.resolver.SCOPE_EPSILON; // must be meaningfully negative
        let negatedConclusionId = -1;
        for (const c of allSinkCandidates) {
          const isDirectlyNegated = [...directlyNegatedScopes].some(
            s => Math.abs(this.system.scope[c.id] - s) < eps
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
        .map(id =>
          this.atomizer
            .decodeSequence(new Uint32Array([id]), this.system)
            .trim()
        )
        .filter(
          t =>
            t &&
            this.system.operatorClass[
            sequenceIds[
            Array.from(sequenceIds).indexOf(
              sequenceIds.find(
                (_, i) =>
                  this.atomizer
                    .decodeSequence(
                      new Uint32Array([sequenceIds[i]]),
                      this.system
                    )
                    .trim() === t
              ) ?? 0
            )
            ]
            ] === OperatorClass.None
        );

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

    const patterns: import("./Synthesizer").CodePattern[] = [];
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
      if (
        Math.abs(scope0 - this.system.scope[subjectIds[0]]) >=
        DOPAT_CONFIG.resolver.SCOPE_EPSILON
      )
        continue;
      if (!this.system.isAllocated(startId)) continue;

      // Verify every token in the subject sequence at consecutive memory positions
      let match = true;
      for (let j = 0; j < subjectIds.length; j++) {
        const cId = startId + j;
        if (
          cId >= length ||
          !this.system.isAllocated(cId) ||
          Math.abs(this.system.scope[cId] - this.system.scope[subjectIds[j]]) >=
          DOPAT_CONFIG.resolver.SCOPE_EPSILON
        ) {
          match = false;
          break;
        }
      }
      if (!match) continue;

      // Check that the operator immediately follows the subject
      const opId = startId + subjectIds.length;
      if (
        opId < length &&
        Math.abs(this.system.scope[opId] - operatorScope) <
        DOPAT_CONFIG.resolver.SCOPE_EPSILON
      ) {
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
        Math.abs(this.system.scope[i] - operatorScope) <
        DOPAT_CONFIG.resolver.SCOPE_EPSILON
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
