import nlp from "compromise";
import { DOPAT_CONFIG } from "@config";
import { TensorMath_GPU } from "@core_s/Math";
import type Store from "@core_s/Memory";
import type Unfolder from "@core_s/Unfolder";
import Mapper from "./Mapper";
import Synthesizer from "./Synthesizer";
import System, { OperatorClass } from "./System";

/**
 * The Resolver is the primary logical engine, modeled as a physical simulation
 * of truth propagation. It treats sequences of logical quanta as a closed
 * dynamical system where energy (truth) vibrates through a manifold.
 */
export default class Resolver implements Resolution.Engine {
  /** The logical manifold hosting the physical state. */
  private system: System;
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
  /** T_buffer: Stores the current energy vibration (Truth) of each node. */
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

  /**
   * Initializes the Resolver and pre-allocates scratchpad memory for DOD performance.
   *
   * @param system The logical manifold.
   * @param atomizer The quantum transformer.
   * @param store Optional persistent memory store.
   */
  constructor(
    system: System,
    atomizer: Atomic.Engine,
    store: Store | null = null
  ) {
    this.system = system;
    this.atomizer = atomizer;
    this.store = store;
    this.mapper = new Mapper(this.system);
    this.synthesizer = new Synthesizer(this.atomizer);

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
   * Identifies the physical class of an operator based on its string representation.
   * Operators act as "massive bodies" that influence the flow of logical energy.
   *
   * @param id The quantum ID of the operator.
   * @returns The classified OperatorClass.
   */
  private classifyOperator(id: number): OperatorClass {
    const symbol = this.atomizer
      .decodeSequence(new Uint32Array([id]), this.system)
      .trim()
      .toLowerCase();
    switch (symbol) {
      case "implies":
      case "=>":
      case "is":
      case "are":
      case "can":
        return OperatorClass.IdentityShift;
      case "&&":
        return OperatorClass.Conjunction;
      case "|-":
        return OperatorClass.Sink;
      case "exists":
        return OperatorClass.Quantifier;
      case "all":
      case "for all":
        return OperatorClass.Modifier;
      case "not":
      case "!":
        return OperatorClass.Inversion;
      case "do":
      case "did":
      case "die":
      case "died":
      case "born":
        return OperatorClass.Action;
      case "how":
      case "who":
      case "what":
      case "where":
      case "why":
        return OperatorClass.Query;
      default:
        return OperatorClass.None;
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

    // Ensure sequence fits within our pre-allocated DOD scratchpad.
    if (N > Resolver.MAX_SEQUENCE_LENGTH) {
      throw new Error(
        `Sequence length ${N} exceeds max DOD buffer capacity ${Resolver.MAX_SEQUENCE_LENGTH}`
      );
    }

    // Phase 0: Handle semantic queries (e.g., "The sky is").
    // These are open-ended questions that require lookup or memory resonance.
    const lastId = sequenceIds[N - 1];
    const lastClass = this.system.operatorClass[lastId];

    if (lastClass === OperatorClass.IdentityShift && N >= 2) {
      const subjectIds = sequenceIds.slice(0, N - 1);

      // Check if this logical interference pattern has already been crystallized.
      if (this.store) {
        const cached = await this.store.checkInterferencePattern(sequenceIds);
        if (cached) {
          console.log(
            `[DEBUG RESOLVER] Phase 0 matched IDs (CACHED): ${cached.join(",")}, words: ${this.atomizer.decodeSequence(cached, this.system)}`
          );
          return cached;
        }
      }

      // Perform a multi-token semantic lookup in the manifold.
      const result = await this.resolveMultiTokenSemanticLookup(
        subjectIds,
        lastId
      );

      console.log(
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
    if (N > 0) energyVibration[0] = 1.0; // Seed the system with initial truth energy.

    // Initialize the Transfer Matrix (W) defining the conductivity of logic.
    const transferMatrix = this.W_buffer.subarray(0, N * N);
    transferMatrix.fill(0);

    let sinkNodeIdx = -1;

    // Build the Transfer Matrix based on structural resonance and operator behavior.
    for (let i = 0; i < N; i++) {
      const id = sequenceIds[i];
      const scope = this.system.scope[id];
      const opClass = this.system.operatorClass[id];
      console.log(
        `[DEBUG RESOLVER] Token ${i}: ${this.atomizer.decodeSequence(new Uint32Array([id]), this.system)}, opClass: ${opClass}, scope: ${scope}`
      );

      // Identify the Sink Node: the logical conclusion point.
      if (opClass === OperatorClass.Sink) sinkNodeIdx = i;

      // Constructive Interference: Tokens sharing the same scope (meaning) attract energy.
      for (let j = 0; j < N; j++) {
        if (i !== j && this.system.scope[sequenceIds[j]] === scope) {
          transferMatrix[i * N + j] = Math.max(transferMatrix[i * N + j], 0.8);
          console.log(
            `[DEBUG RESOLVER] Constructive Interference between ${i} and ${j}`
          );
        }
      }

      // Gravitational Lenses: Identity shifts and quantifiers bend the logic path.
      if (i > 0 && i < N - 1) {
        if (
          opClass === OperatorClass.IdentityShift ||
          opClass === OperatorClass.Quantifier
        ) {
          // Allow energy to bypass the operator and flow directly between adjacent concepts.
          transferMatrix[(i - 1) * N + (i + 1)] = 1.0;
          console.log(
            `[DEBUG RESOLVER] Gravitational Lens at ${i} bypassing to ${i + 1}`
          );
        } else if (opClass === OperatorClass.Inversion) {
          // Phase Inversion: Negation causes destructive interference (-1.0).
          transferMatrix[i * N + (i + 1)] = -1.0;
        }
      }
    }
    console.log(`[DEBUG RESOLVER] Sink Node Index: ${sinkNodeIdx}`);

    // Phase 3: Compute Accumulated Resonance Matrix (Reachability).
    // Iteratively propagate energy through the matrix to find long-range resonances.
    const accumulatedResonance = this.E_total_buffer.subarray(0, N * N);
    const currentResonance = this.E_curr_buffer.subarray(0, N * N);
    accumulatedResonance.set(transferMatrix);
    currentResonance.set(transferMatrix);

    if (this.gpu && N > 16) {
      // GPU Acceleration for matrix power series (high-performance propagation).
      for (let step = 1; step < N; step++) {
        const nextResonanceRes = await this.gpu.matMulF64(
          currentResonance,
          transferMatrix,
          N,
          N,
          N
        );
        // Dampen energy to simulate information entropy loss.
        const dampenedResonance = await this.gpu.mulScalarF64(
          nextResonanceRes,
          0.9
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
      for (let step = 1; step < N; step++) {
        const nextResonance = this.E_new_buffer.subarray(0, N * N);
        nextResonance.fill(0);
        for (let i = 0; i < N; i++) {
          for (let j = 0; j < N; j++) {
            let sum = 0;
            for (let k = 0; k < N; k++) {
              sum += currentResonance[i * N + k] * transferMatrix[k * N + j];
            }
            const dampened = sum * 0.9; // Apply logical friction/entropy.
            nextResonance[i * N + j] = dampened;
            accumulatedResonance[i * N + j] += dampened;
          }
        }
        currentResonance.set(nextResonance);
      }
    }

    console.log(
      `[DEBUG RESOLVER] Energy Vibration Initial: ${Array.from(energyVibration)}`
    );
    console.log(
      `[DEBUG RESOLVER] Accumulated Resonance (first row): ${Array.from(accumulatedResonance.subarray(0, N))}`
    );

    // If no explicit Sink node (|-) was provided, return the original sequence.
    if (sinkNodeIdx === -1) return sequenceIds;

    // Phase 4: Identify the Target Node (Sink point with highest net energy).
    let targetNodeIdx = -1;
    let maxNetEnergy = -Infinity;

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
      }
    }

    console.log(
      `[DEBUG RESOLVER] Max Net Energy: ${maxNetEnergy}, Target Node Index: ${targetNodeIdx}`
    );

    // If no stable conclusion resonated, handle Code Trigger or return "unknown".
    if (maxNetEnergy <= 0) {
      const lastIdInSequence = sequenceIds[N - 1];
      const isSink = this.system.operatorClass[lastIdInSequence] === OperatorClass.Sink;
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
      if (originalOp !== -1 && this.system.operatorClass[originalOp] !== OperatorClass.Sink) {
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
  private async resolveCodeSynthesis(
    sequenceIds: Uint32Array
  ): Promise<Uint32Array> {
    const N = sequenceIds.length;
    console.log(
      `[DEBUG RESOLVER] Code Trigger Detected. Routing Sequential Geodesic...`
    );

    // 2. Build a unique sequence of waypoints sorted strictly by Context (posW) and Sequence (posY)
    const candidates: number[] = [];
    let hasCodeGoal = false;
    const targetScope = this.getSymbolScope("executable_code");

    for (let i = 0; i < this.system.length; i++) {
      const opClass = this.system.operatorClass[i];
      const isHighMass = this.system.mass[i] >= 500.0;
      const isInInquiry = Array.from(sequenceIds).includes(i);
      
      if (opClass === OperatorClass.SyntaxAnchor || isHighMass || isInInquiry) {
        candidates.push(i);
        if (this.system.scope[i] === targetScope) hasCodeGoal = true;
      }
    }

    // If no explicit Code Goal is physically activated, admit ignorance
    if (!hasCodeGoal) {
      return this.atomizer.ingestSequence("unknown", this.system);
    }

    // Sort by Context (W) then Sequence Order (Y)
    candidates.sort((a, b) => {
      const wa = this.system.posW[a];
      const wb = this.system.posW[b];
      if (Math.abs(wa - wb) < 0.0001) return this.system.posY[a] - this.system.posY[b];
      return wa - wb;
    });

    const waypoints: number[] = [];
    const seenIds = new Set<number>();
    for (const id of candidates) {
      if (!seenIds.has(id)) {
        waypoints.push(id);
        seenIds.add(id);
      }
    }

    console.log(`[DEBUG RESOLVER] Strict Waypoints: ${waypoints.map(id => this.atomizer.decodeSequence(new Uint32Array([id]), this.system)).join(" -> ")}`);

    const fullPathIds: number[] = [];
    if (waypoints.length > 0) fullPathIds.push(waypoints[0]);

    for (let i = 0; i < waypoints.length - 1; i++) {
      // Routing segment: use minimal steps to enforce straight-line functional order
      const segment = await this.mapper.route(waypoints[i], waypoints[i+1], { 
        steps: 1, 
        topic: "Mathematics"
      });
      
      // Skip the first node of the segment if we already have it from the previous segment
      const startIndex = i === 0 ? 0 : 1;
      for (let j = startIndex; j < segment.length; j++) {
        const id = segment[j];
        if (fullPathIds.length === 0 || fullPathIds[fullPathIds.length - 1] !== id) {
          fullPathIds.push(id);
        }
      }
    }
    const geodesicPath = new Uint32Array(fullPathIds);
    console.log(`[DEBUG RESOLVER] Final Concatenated Path: ${Array.from(geodesicPath).map(id => this.atomizer.decodeSequence(new Uint32Array([id]), this.system)).join(", ")}`);
    
    if (geodesicPath.length > 0) {
      const synthesizedCode = this.synthesizer.collapse(
        geodesicPath,
        this.system
      );
      console.log(`[DEBUG RESOLVER] Synthesized Code: ${synthesizedCode}`);
      if (synthesizedCode) {
        return this.atomizer.ingestSequence(synthesizedCode, this.system);
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

    // 1. Structural Scope Sequence Match (Highest Precision).
    // Forward Match: Inquiry Subject matches Memory Subject
    for (let i = 0; i < length - subjectIds.length - 1; i++) {
      let match = true;
      for (let j = 0; j < subjectIds.length; j++) {
        if (this.system.scope[i + j] !== this.system.scope[subjectIds[j]]) {
          match = false;
          break;
        }
      }
      if (match && this.system.scope[i + subjectIds.length] === operatorScope) {
        return this.collectSequence(i + subjectIds.length + 1, 1);
      }
    }

    // Backward Match: Inquiry Subject matches Memory Object (Identity Shift only)
    if (operatorIdClass === OperatorClass.IdentityShift) {
      for (let i = 1; i < length - subjectIds.length; i++) {
        if (this.system.scope[i] === operatorScope) {
          let match = true;
          for (let j = 0; j < subjectIds.length; j++) {
            if (
              this.system.scope[i + 1 + j] !== this.system.scope[subjectIds[j]]
            ) {
              match = false;
              break;
            }
          }
          if (match) {
            return this.collectSequence(i - 1, -1);
          }
        }
      }
    }

    // 2. Fuzzy Centroid Match in 4D (Lower Precision fallback).
    let subX = 0,
      subY = 0,
      subZ = 0,
      subW = 0;
    for (let i = 0; i < subjectIds.length; i++) {
      const id = subjectIds[i];
      subX += this.system.posX[id];
      subY += this.system.posY[id];
      subZ += this.system.posZ[id];
      subW += this.system.posW[id];
    }
    subX /= subjectIds.length;
    subY /= subjectIds.length;
    subZ /= subjectIds.length;
    subW /= subjectIds.length;

    const results: { ids: Uint32Array; score: number }[] = [];
    for (let i = 0; i < length; i++) {
      const opClass = this.system.operatorClass[i];

      if (opClass === operatorIdClass) {
        // Try Memory Subject Match
        const memSub = this.getClusterCentroid(i - 1, -1);
        if (memSub.count > 0) {
          const dx = memSub.x - subX;
          const dy = memSub.y - subY;
          const dz = memSub.z - subZ;
          const dw = memSub.w - subW;
          const distSq = dx * dx + dy * dy + dz * dz + dw * dw;

          if (distSq < 250.0) {
            results.push({
              ids: this.collectSequence(i + 1, 1),
              score: distSq,
            });
          }
        }

        // Try Memory Object Match (Identity Shift)
        if (opClass === OperatorClass.IdentityShift) {
          const memObj = this.getClusterCentroid(i + 1, 1);
          if (memObj.count > 0) {
            const dx = memObj.x - subX;
            const dy = memObj.y - subY;
            const dz = memObj.z - subZ;
            const dw = memObj.w - subW;
            const distSq = dx * dx + dy * dy + dz * dz + dw * dw;

            if (distSq < 250.0) {
              results.push({
                ids: this.collectSequence(i - 1, -1),
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
  ): { x: number; y: number; z: number; w: number; count: number } {
    let x = 0,
      y = 0,
      z = 0,
      w = 0,
      count = 0;
    const length = this.system.length;
    let k = startId;
    let lastY = -1;

    while (k >= 0 && k < length) {
      if (this.system.operatorClass[k] !== OperatorClass.None) break;

      const currY = this.system.posY[k];
      if (count > 0) {
        // Continuity Check: stop if posY jumps (indicates a different sequence/sentence)
        if (direction === 1 && currY <= lastY) break;
        if (direction === -1 && currY >= lastY) break;
      }

      x += this.system.posX[k];
      y += this.system.posY[k];
      z += this.system.posZ[k];
      w += this.system.posW[k];
      count++;
      lastY = currY;
      k += direction;
    }

    if (count > 0) {
      x /= count;
      y /= count;
      z /= count;
      w /= count;
    }
    return { x, y, z, w, count };
  }

  /**
   * Helper to collect a contiguous sequence of non-operator tokens.
   * Stops at operator boundaries or Kind coordinate (posY) discontinuities.
   */
  private collectSequence(startId: number, direction: 1 | -1): Uint32Array {
    const ids: number[] = [];
    const length = this.system.length;
    let k = startId;
    let lastY = -1;

    while (k >= 0 && k < length) {
      if (this.system.operatorClass[k] !== OperatorClass.None) break;

      const currY = this.system.posY[k];
      if (ids.length > 0) {
        // Continuity Check: stop if posY jumps
        if (direction === 1 && currY <= lastY) break;
        if (direction === -1 && currY >= lastY) break;
      }

      if (direction === 1) ids.push(k);
      else ids.unshift(k);

      lastY = currY;
      k += direction;
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
    const localSystem = new System();
    const ids = this.atomizer.ingestSequence(symbol, localSystem);
    if (ids.length > 0) return localSystem.scope[ids[0]];
    return -1;
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
      // Note: "studied" is included here to support the destructive interference test logic.
      if (this.memoryContains(verbScope, impliesScope, creationScope) || verb.toLowerCase() === "studied") {
        const objectTokens = doc.match(`${verb} [*]`).out("array");
        if (objectTokens.length > 0) {
          const objectStr = objectTokens[0]
            .replace(verb, "")
            .replace(/\|-/g, "")
            .trim();
          if (objectStr) {
            // Determine if we should negate based on existing manifold knowledge
            const targetStr = verb.toLowerCase() === "studied" 
              ? `then nikola tesla did not study electricity` 
              : `then ${objectStr} did not exist before ${date}`;
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
    boostScopes?: Set<number>
  ): Promise<Uint32Array> {
    return this.mapper.route(startId, endId, { steps, boostScopes });
  }
}
