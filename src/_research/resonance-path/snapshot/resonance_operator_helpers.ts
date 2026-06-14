private
discoverOperatorsByResonance(
    sequenceIds: Uint32Array,
    N: number,
    accumulated: Float64Array
  )
: DiscoveredOperator[]
{
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

private
findDominantOperator(
    sequenceIds: Uint32Array,
    sourceNodeIdx?: number
  )
: number
{
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
