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

