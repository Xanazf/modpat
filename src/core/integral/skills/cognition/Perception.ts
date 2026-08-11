/**
 * Perception – the Observe → Follow → Read pipeline as a plain function module.
 *
 * All functions take their dependencies explicitly. Mutable cache state
 * (semantic spatial index, synthesizer) is bundled in Cognition.PerceptionCache, which
 * the Traveler creates once and passes on every call.
 */

import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import { DOPAT_CONFIG } from "@config";
import { resolveCompositionQuery } from "@core_i/formula/Composition";
import { resolveLogicFormula } from "@core_i/formula/E1Formula";
import { resolveWave } from "@core_i/formula/WaveResolver";
import { OperatorClass, SlotType } from "@core_i/helpers/enums";
import type Store from "@core_s/Memory";
import { metrics } from "@core_s/Metrics";
import { resolveActiveAtoms } from "@mutate/FrameworkIndex";
import { detokenizeCode, Synthesizer } from "@skill_code/Coder";
import { gateEmit } from "@skill_cogi/Coherence";
import { reduceAdditive, reduceStatements } from "@skill_cogi/Reduction";
import nlp from "compromise";

/** Parses an integer numeral; null for non-numeric tokens. */
function _numeralValue(token: string): number | null {
  if (!/^-?\d+$/.test(token)) return null;
  const v = Number(token);
  return Number.isFinite(v) ? v : null;
}

// -- Types ------------------------------------------------------------------

type PerceptionOptions = Mapping.PerceptionOptions;
type CoherentResult = Mapping.CoherentResult;
type PerceptionCapture = Mapping.PerceptionCapture;

export function makePerceptionCache(): Cognition.PerceptionCache {
  return {
    spatialIndex: new GridIndex4D(),
    lastIndexedLength: -1,
    synthesizer: new Synthesizer(),
  };
}

// -- Public API -------------------------------------------------------------

export async function perceive(
  ids: Uint32Array,
  opts: PerceptionOptions,
  deps: Cognition.PerceptionDeps,
  cache: Cognition.PerceptionCache,
  maxLen: number
): Promise<Cognition.PerceiveResult> {
  if (ids.length > maxLen) {
    throw new Error(
      `Sequence length ${ids.length} exceeds max DOD buffer capacity ${maxLen}`
    );
  }
  const result = await observeSettlingGradient(ids, opts, deps, cache);
  if (!opts.gated) return { ...result, confidence: "definitive" };
  if (result.ids.length === 0) return { ...result, confidence: "silent" };

  // Phase 2 emission gate. "unknown" is already an abstain, pass it through.
  const decoded = deps.atomizer
    .decodeSequence(result.ids, deps.system)
    .trim()
    .toLowerCase();
  if (decoded === "unknown") return { ...result, confidence: "silent" };

  deps.buildGridIndex();
  const verdict = gateEmit(
    ids,
    result.ids,
    deps.system,
    deps.gridIndex,
    deps.lastInferentialEffort,
    { ruleDerived: result.provenance !== "cluster" }
  );
  if (verdict.emit) return { ...result, confidence: "definitive" };

  // Graded abstention: the candidate failed the gate, so it must not be
  // emitted as an answer - but it is not nothing. Return the abstain ids
  // ("unknown") with the candidate attached, so the user-facing layer can say
  // "it's possible that X, but I can't give a definitive answer".
  return {
    ids: deps.atomizer.ingestSequence("unknown", deps.system),
    sinkStrength: 0,
    provenance: result.provenance,
    confidence: "hedged",
    candidate: result.ids,
  };
}

export async function perceiveCapturing(
  ids: Uint32Array,
  opts: PerceptionOptions,
  deps: Cognition.PerceptionDeps,
  cache: Cognition.PerceptionCache,
  maxLen: number
): Promise<PerceptionCapture> {
  const r = await perceive(ids, opts, deps, cache, maxLen);
  return {
    ids: r.ids,
    diagnostics: null,
    sinkStrength: r.sinkStrength,
    discoveredOperators: [],
    bridgeCandidates: [],
  };
}

export async function perceiveCoherent(
  ids: Uint32Array,
  opts: {
    probeMode?: boolean;
    maxIterations?: number;
    contextScopes?: Set<number>;
    /** Apply the Phase 2 emission gate (same block as perceive()). The live
     *  query path was measured emitting token-soup commitments precisely
     *  because this path historically bypassed the gate. */
    gated?: boolean;
  },
  deps: Cognition.PerceptionDeps,
  cache: Cognition.PerceptionCache,
  _maxLen: number
): Promise<CoherentResult> {
  const r = await observeSettlingGradient(
    ids,
    { contextScopes: opts.contextScopes, probeMode: opts.probeMode },
    deps,
    cache
  );
  const coherence = Math.max(0, 1 - deps.lastInferentialEffort);
  // Gate only the RAW settling fallback (cluster/geodesic): the measured
  // token-soup confident falsehoods came from arriving at a sink with no
  // symbolic mechanism behind it. Every other provenance is a constructor-
  // guaranteed or crystallized-proof mechanism (vault recall, rule
  // discharge, arithmetic composition, ...) that skips the settle/locomotion
  // loop these fast-paths return before - so deps.lastInferentialEffort can
  // be stale for them, and gateEmit's geometric pathCoherence bar was
  // calibrated against physics-only settling, not against a cache hit.
  // Re-litigating an already-verified derivation through it is redundant at
  // best and miscalibrated at worst (measured: rejected a correct vault
  // recall on the number-line corpus's minimal manifold).
  const untrusted = r.provenance === "cluster" || r.provenance === "geodesic";
  if (opts.gated && untrusted && r.ids.length > 0) {
    const decoded = deps.atomizer
      .decodeSequence(r.ids, deps.system)
      .trim()
      .toLowerCase();
    if (decoded !== "unknown") {
      deps.buildGridIndex();
      const verdict = gateEmit(
        ids,
        r.ids,
        deps.system,
        deps.gridIndex,
        deps.lastInferentialEffort,
        { ruleDerived: false }
      );
      if (!verdict.emit) {
        return {
          ids: deps.atomizer.ingestSequence("unknown", deps.system),
          coherence: 0,
          iterations: 1,
          learned: [],
          diagnosis: "gated",
          diagnostics: null,
        };
      }
    }
  }
  return {
    ids: r.ids,
    coherence,
    iterations: 1,
    learned: [],
    diagnosis: r.ids.length > 0 ? "coherent" : "void",
    diagnostics: null,
    text: r.text,
  };
}

// -- Observe → Follow → Read ------------------------------------------------

export async function observeSettlingGradient(
  ids: Uint32Array,
  opts: PerceptionOptions,
  deps: Cognition.PerceptionDeps,
  cache: Cognition.PerceptionCache
): Promise<Cognition.ObserveResult> {
  if (ids.length === 0)
    return { ids: new Uint32Array(0), sinkStrength: 0, provenance: "void" };
  const {
    system,
    atomizer,
    store,
    language,
    lifecycle,
    gridIndex,
    buildGridIndex,
    traverse,
    boostAtomMasses,
    position,
    activeFrameworks,
  } = deps;

  // Phase 0a: exact code-intent recall.
  //
  // Code synthesis used to run as the LAST fast-path (Phase 0.5 below), which
  // meant any earlier path that produced anything at all for a sink-terminated
  // query won - even against a vault row keyed by the exact intent. Measured:
  // `function is Even |-` had `isEven` sitting in the vault under an exact key
  // and was answered `"even"` by semantic derivation instead, and
  // `function lesser Of |-` was answered `"unknown"`.
  //
  // An EXACT code key is unambiguous by construction, so when one matches there
  // is nothing for a fuzzier mechanism to add. Only the exact branch is hoisted;
  // the attractor-composition fallback stays at Phase 0.5, where it must not
  // preempt vault recall. Deduction is untouched because a `CODE:` key exists
  // only for a crystallized code pattern - a logic query cannot mint one.
  if (
    store &&
    ids.length > 0 &&
    system.operatorClass[ids[ids.length - 1]] === OperatorClass.Sink
  ) {
    const exact = await _resolveCodeSynthesis(
      ids,
      system,
      atomizer,
      store,
      cache,
      { exactOnly: true }
    );
    if (exact.text)
      return {
        ids: exact.ids,
        sinkStrength: 1.0,
        provenance: "synth",
        text: exact.text,
      };
  }

  // Phase 0b: vault recall
  if (!opts.probeMode) {
    const derivation = await _resolveSemanticDerivation(ids, deps);
    if (derivation) {
      if (store) {
        boostAtomMasses(ids);
        boostAtomMasses(derivation);
      }
      return { ids: derivation, sinkStrength: 1.0, provenance: "vault" };
    }
  }

  // Phase 0c: reduction-as-traversal. Computing IS moving - additive arithmetic
  // composes the operands' grounded W positions to the reduct, and universal
  // instantiation walks the IS-graph from the subject to a derived predicate
  // (hop >= 2 means a rule fired; anything less is just a restatement of the
  // premises, so we leave those to the existing path).
  if (!opts.probeMode) {
    const reduct = _resolveReduction(ids, system, atomizer);
    if (reduct && reduct.length > 0) {
      if (store) {
        await store.crystallizeProof(ids, reduct, 1.0);
        boostAtomMasses(ids);
        boostAtomMasses(reduct);
      }
      return { ids: reduct, sinkStrength: 1.0, provenance: "reduction" };
    }
  }

  // Phase 0d: concept composition (step 12). "A and B make Z" composes the two
  // parents into a product atom (binding the name Z to its compound scope); "what
  // is Z made of" decomposes a composed concept back to its two parents. Pure
  // scope arithmetic over the existing Composition primitive; gated to non-probe
  // mode because synthesis mints (and names) a product atom.
  if (!opts.probeMode) {
    const composed = resolveCompositionQuery(ids, system, atomizer);
    if (composed && composed.length > 0) {
      if (store) {
        await store.crystallizeProof(ids, composed, 1.0);
        boostAtomMasses(ids);
        boostAtomMasses(composed);
      }
      return { ids: composed, sinkStrength: 1.0, provenance: "composition" };
    }
  }

  // Phase 0: PartLayer topology walk
  const N = ids.length;
  const lastId = ids[N - 1];
  const lastClass = system.operatorClass[lastId];
  let queryOpId = lastId,
    queryOpClass = lastClass;
  let subjectIds = ids.slice(0, N - 1);
  if (lastClass === OperatorClass.Sink && N >= 3) {
    const prevId = ids[N - 2];
    if (system.operatorClass[prevId] === OperatorClass.IdentityShift) {
      queryOpId = prevId;
      queryOpClass = system.operatorClass[prevId];
      subjectIds = ids.slice(0, N - 2);
    }
  }
  if (queryOpClass === OperatorClass.IdentityShift && subjectIds.length > 0) {
    const topoResult = _resolveMultiTokenSemanticLookup(
      subjectIds,
      queryOpId,
      system,
      cache
    );
    if (topoResult.length > 0) {
      if (!opts.probeMode && store) {
        await store.crystallizeProof(ids, topoResult, 1.0);
        boostAtomMasses(ids);
        boostAtomMasses(topoResult);
      }
      return { ids: topoResult, sinkStrength: 1.0, provenance: "partlayer" };
    }
  }

  // Phase E1: fuzzy connective formula resolution (symbolic; the fast cache).
  // Its success path crystallizes a proof, so it stays gated to non-probe mode.
  if (!opts.probeMode) {
    const e1Result = resolveLogicFormula(ids, system);
    if (e1Result !== null && e1Result.length > 0) {
      if (store) {
        await store.crystallizeProof(ids, e1Result, 1.0);
        boostAtomMasses(ids);
        boostAtomMasses(e1Result);
      }
      return { ids: e1Result, sinkStrength: 1.0, provenance: "formula" };
    }
  }

  // Phase E1w: wave interference. E1Formula returns null on a contradiction
  // (a concept superposed with its negation) and defers; the wave channel
  // DERIVES the verdict from geometry - the opposing atoms cancel to a
  // zero-amplitude band, and that flat band IS the conclusion `unknown`. Wave
  // is the authority for the case the symbolic rules structurally cannot
  // express; it preempts the noisy cluster/settling fallback below.
  //
  // Step 11: this runs in PROBE MODE too. It is pure geometry with no proof
  // crystallization or mass boosting (only the terminal output is materialized,
  // as every return path does), and probe mode - used by learnCycle / challenge
  // for physics-only verification - is exactly where a contradiction settling to
  // a noisy cluster answer would be wrong. A contradiction is wrong in any mode.
  {
    const wave = resolveWave(ids, system);
    if (wave?.contradiction) {
      return {
        ids: atomizer.ingestSequence("unknown", system),
        sinkStrength: 0,
        provenance: "interference",
      };
    }
    // Step 10: beyond contradiction, the wave channel also reads a determinate
    // `¬antecedent` off the geometry (an implication bridge rotated the antecedent
    // band by π - modus tollens). E1Formula handles the well-formed MT phrasings
    // as the fast cache and returns above; this fires when its parser missed the
    // shape, so Wave is the authority for the whole opposition family, and it
    // carries a graded sink confidence (the band coherence) E1 cannot give.
    if (wave?.conclusion) {
      const word = atomizer.resolveScope(wave.conclusion.scope);
      if (word && word !== "unknown") {
        return {
          ids: atomizer.ingestSequence(`not ${word}`, system),
          sinkStrength: wave.conclusion.confidence,
          provenance: "interference",
        };
      }
    }
  }

  // Phase 0.5: code synthesis fast-path
  if (
    store &&
    N > 0 &&
    system.operatorClass[ids[N - 1]] === OperatorClass.Sink
  ) {
    const synth = await _resolveCodeSynthesis(
      ids,
      system,
      atomizer,
      store,
      cache
    );
    const decoded = atomizer.decodeSequence(synth.ids, system).trim();
    if (decoded && decoded !== "unknown")
      return {
        ids: synth.ids,
        sinkStrength: 0,
        provenance: "synth",
        // The emitted source, NOT re-derived from ids. Ingesting the program
        // and decoding it back would re-apply every loss the detokenizer just
        // undid (`=` -> `equals`, case flattening), so the fix has to travel
        // past the round trip rather than through it.
        text: synth.text,
      };
  }

  // E0: active frameworks + E1 framework boost
  let activeAtoms: Set<number> | undefined;
  let effectiveBoost: Set<number> | undefined = opts.contextScopes;
  if (lifecycle) {
    const index = lifecycle.getFrameworkIndex();
    if (index && activeFrameworks.size > 0) {
      activeAtoms = resolveActiveAtoms(index, activeFrameworks);
      const boost = new Set<number>(opts.contextScopes ?? []);
      for (const sc of index.superclusters) {
        if (activeFrameworks.has(sc.id))
          for (const s of sc.seedAtomIds) {
            if (system.isAllocated(s)) boost.add(system.scope[s]);
          }
      }
      for (const cl of index.clusters) {
        if (activeFrameworks.has(cl.id))
          for (const s of cl.seedAtomIds) {
            if (system.isAllocated(s)) boost.add(system.scope[s]);
          }
      }
      if (boost.size > 0) effectiveBoost = boost;
    }
  }

  // Observe: settle probe
  buildGridIndex();
  const driftTargets =
    language?.takeDriftTargets() ??
    new Map<number, readonly [number, number, number, number]>();
  if (DOPAT_CONFIG.PHYSICS.POLE_INGESTION_ENABLED && driftTargets.size > 0) {
    settleAtoms(ids, driftTargets, effectiveBoost, activeAtoms, deps);
    buildGridIndex();
  }
  const settled = _settleProbe(
    ids,
    driftTargets,
    effectiveBoost,
    activeAtoms,
    deps
  );
  if (!settled)
    return {
      ids: atomizer.ingestSequence("unknown", system),
      sinkStrength: 0,
      provenance: "void",
    };

  const { x: sx, y: sy, z: sz, w: sw } = settled;
  const nearRadius = Math.sqrt(DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS);

  // Follow: identify source and sink
  const sinkId = gridIndex.nearest(
    sx,
    sy,
    sz,
    sw,
    nearRadius * 4,
    system,
    activeAtoms
  );
  if (sinkId === -1)
    return {
      ids: atomizer.ingestSequence("unknown", system),
      sinkStrength: 0,
      provenance: "void",
    };

  const travelerDisp =
    position[0] ** 2 + position[1] ** 2 + position[2] ** 2 + position[3] ** 2;
  let sourceId =
    travelerDisp > 0.01
      ? (gridIndex.nearest(
          position[0],
          position[1],
          position[2],
          position[3],
          nearRadius * 4,
          system,
          activeAtoms
        ) ?? -1)
      : -1;
  if (sourceId === -1) sourceId = _heaviestInput(ids, system);

  // When the naive source (traveler position / heaviest input) collapses onto
  // the settled sink, a premise→conclusion geodesic would be a zero-length
  // self-loop - the path that historically routed real queries into the
  // mass-ranked cluster fallback below (a fluent-echo failure mode), leaving the
  // geodesic dormant. Recover a DISTINCT source from the remaining inputs so a
  // genuine multi-premise query actually traverses the faithful map.
  if (sourceId === sinkId) {
    metrics.increment("perception.source_collapsed");
    sourceId = _heaviestInputExcluding(ids, system, sinkId);
  }

  if (sourceId === -1 || sourceId === sinkId) {
    metrics.increment("perception.cluster_fallback");
    const candidates = gridIndex
      .candidatesInRadius(sx, sy, sz, sw, nearRadius)
      .filter(id => system.isAllocated(id));
    const filtered = activeAtoms
      ? candidates.filter(id => activeAtoms!.has(id))
      : candidates;
    return {
      ids: new Uint32Array(
        filtered.sort((a, b) => system.mass[b] - system.mass[a]).slice(0, 16)
      ),
      sinkStrength: 0,
      provenance: "cluster",
    };
  }

  // Read: traverse source → sink
  metrics.increment("perception.geodesic");
  const result = await traverse(sourceId, sinkId, {
    boostScopes: effectiveBoost,
    activeAtoms,
  });
  return { ids: result, sinkStrength: 0, provenance: "geodesic" };
}

// -- Settling helpers --------------------------------------------------------

export function settleAtoms(
  ids: Uint32Array,
  driftTargets: Map<number, readonly [number, number, number, number]>,
  boost: Set<number> | undefined,
  activeAtoms: Set<number> | undefined,
  deps: Cognition.PerceptionDeps
): void {
  const { system, getMetricForce } = deps;
  const step = DOPAT_CONFIG.PHYSICS.GRADIENT_STEP;
  const maxTicks = DOPAT_CONFIG.PHYSICS.SETTLE_MAX_TICKS;
  const threshold = DOPAT_CONFIG.PHYSICS.SETTLE_CONVERGENCE_THRESHOLD;
  const SPRING = 0.1;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    if (!system.isAllocated(id)) continue;
    const target = driftTargets.get(id);
    if (!target) continue;
    const [tx, ty, tz, tw] = target;
    let px = system.posX[id],
      py = system.posY[id],
      pz = system.posZ[id],
      pw = system.posW[id];
    for (let tick = 0; tick < maxTicks; tick++) {
      const [, fx, fy, fz, fw] = getMetricForce(
        px,
        py,
        pz,
        pw,
        [],
        boost,
        activeAtoms
      );
      const dx = (-fx + (tx - px) * SPRING) * step,
        dy = (-fy + (ty - py) * SPRING) * step;
      const dz = (-fz + (tz - pz) * SPRING) * step,
        dw = (-fw + (tw - pw) * SPRING) * step;
      px += dx;
      py += dy;
      pz += dz;
      pw += dw;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) < threshold) break;
    }
    system.posX[id] = px;
    system.posY[id] = py;
    system.posZ[id] = pz;
    system.posW[id] = pw;
    system.update(id);
  }
}

function _settleProbe(
  ids: Uint32Array,
  driftTargets: Map<number, readonly [number, number, number, number]>,
  boost: Set<number> | undefined,
  activeAtoms: Set<number> | undefined,
  deps: Cognition.PerceptionDeps
): { x: number; y: number; z: number; w: number } | null {
  const { system, getMetricForce } = deps;
  let cx = 0,
    cy = 0,
    cz = 0,
    cw = 0,
    n = 0;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    if (!system.isAllocated(id)) continue;
    cx += system.posX[id];
    cy += system.posY[id];
    cz += system.posZ[id];
    cw += system.posW[id];
    n++;
  }
  if (n === 0) return null;
  cx /= n;
  cy /= n;
  cz /= n;
  cw /= n;
  if (DOPAT_CONFIG.PHYSICS.POLE_INGESTION_ENABLED)
    return { x: cx, y: cy, z: cz, w: cw };

  let dtx = 0,
    dty = 0,
    dtz = 0,
    dtw = 0,
    dn = 0;
  for (const [, [tx, ty, tz, tw]] of driftTargets) {
    dtx += tx;
    dty += ty;
    dtz += tz;
    dtw += tw;
    dn++;
  }
  if (dn > 0) {
    dtx /= dn;
    dty /= dn;
    dtz /= dn;
    dtw /= dn;
  }
  const SPRING = 0.1,
    step = DOPAT_CONFIG.PHYSICS.GRADIENT_STEP;
  const maxTicks = DOPAT_CONFIG.PHYSICS.SETTLE_MAX_TICKS,
    threshold = DOPAT_CONFIG.PHYSICS.SETTLE_CONVERGENCE_THRESHOLD;
  let px = cx,
    py = cy,
    pz = cz,
    pw = cw;
  for (let tick = 0; tick < maxTicks; tick++) {
    const [, fx, fy, fz, fw] = getMetricForce(
      px,
      py,
      pz,
      pw,
      [],
      boost,
      activeAtoms
    );
    const dx = (-fx + (dn > 0 ? (dtx - px) * SPRING : 0)) * step;
    const dy = (-fy + (dn > 0 ? (dty - py) * SPRING : 0)) * step;
    const dz = (-fz + (dn > 0 ? (dtz - pz) * SPRING : 0)) * step;
    const dw = (-fw + (dn > 0 ? (dtw - pw) * SPRING : 0)) * step;
    px += dx;
    py += dy;
    pz += dz;
    pw += dw;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw) < threshold) break;
  }
  return { x: px, y: py, z: pz, w: pw };
}

function _heaviestInput(ids: Uint32Array, system: Root.ManifoldView): number {
  let bestId = -1,
    bestMass = -Infinity;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    if (!system.isAllocated(id)) continue;
    const m = system.mass[id];
    if (m > bestMass) {
      bestMass = m;
      bestId = id;
    }
  }
  return bestId;
}

/** Heaviest allocated input atom whose id differs from `exclude` (-1 if none). */
function _heaviestInputExcluding(
  ids: Uint32Array,
  system: Root.ManifoldView,
  exclude: number
): number {
  let bestId = -1,
    bestMass = -Infinity;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    if (id === exclude || !system.isAllocated(id)) continue;
    const m = system.mass[id];
    if (m > bestMass) {
      bestMass = m;
      bestId = id;
    }
  }
  return bestId;
}

// -- Reduction-as-traversal --------------------------------------------------

/**
 * Tries the two reduction fast-paths:
 *   1) additive arithmetic - Arithmetic operator flanked by numeric operands;
 *      reduceAdditive composes them on the W number line.
 *   2) statement reduction - Sink-terminated query whose premises form an
 *      IS-graph plus implications ("if A then C") and disjunctions ("either A
 *      or B"); reduceStatements fires those rules to fixpoint and walks the
 *      graph from the subject. Fires only when a rule was applied (hop >= 2 or
 *      a derived edge was crossed), so it cannot regress transitivity cases
 *      (where the subject is a chain end with no outgoing edges). Negative
 *      universals license negative conclusions ("felix |-" => "not fish").
 */
function _resolveReduction(
  ids: Uint32Array,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): Uint32Array | null {
  // 1) additive arithmetic
  for (let i = 1; i < ids.length - 1; i++) {
    const opId = ids[i];
    if (system.operatorClass[opId] !== OperatorClass.Arithmetic) continue;
    const aId = ids[i - 1];
    const bId = ids[i + 1];
    if (system.operatorClass[aId] !== OperatorClass.None) continue;
    if (system.operatorClass[bId] !== OperatorClass.None) continue;
    const aTok = atomizer.decodeSequence(new Uint32Array([aId]), system).trim();
    const bTok = atomizer.decodeSequence(new Uint32Array([bId]), system).trim();
    if (_numeralValue(aTok) === null || _numeralValue(bTok) === null) continue;
    const opTok = atomizer
      .decodeSequence(new Uint32Array([opId]), system)
      .trim();
    const r = reduceAdditive(opTok, aId, bId, system, atomizer);
    if (r) return new Uint32Array([r.resultId]);
  }

  // 2) universal instantiation
  const N = ids.length;
  if (N === 0) return null;
  if (system.operatorClass[ids[N - 1]] !== OperatorClass.Sink) return null;

  let subjectId = -1;
  for (let i = N - 2; i >= 0; i--) {
    if (system.operatorClass[ids[i]] === OperatorClass.None) {
      subjectId = ids[i];
      break;
    }
  }
  if (subjectId === -1) return null;
  const subject = atomizer
    .decodeSequence(new Uint32Array([subjectId]), system)
    .trim();
  if (!subject) return null;

  const text = atomizer.decodeSequence(ids, system);
  const r = reduceStatements(subject, text);

  // Deepest-hop derivation wins - it represents the longest applied chain of
  // rules and is the genuinely downstream conclusion. Positive conclusions
  // outrank negative ones; a negative derivation ("felix is not a fish") is
  // emitted with its negation made explicit.
  const deepest = (set: string[], hops: Map<string, number>): string => {
    let best = set[0];
    let bestHop = hops.get(best) ?? 0;
    for (const c of set) {
      const h = hops.get(c) ?? 0;
      if (h > bestHop) {
        best = c;
        bestHop = h;
      }
    }
    return best;
  };
  if (r.derived.length > 0) {
    return atomizer.ingestSequence(deepest(r.derived, r.hops), system);
  }
  if (r.derivedNegative.length > 0) {
    const best = deepest(r.derivedNegative, r.negHops);
    return atomizer.ingestSequence(`not ${best}`, system);
  }
  return null;
}

// -- Code synthesis ----------------------------------------------------------

/*
 * EMISSION, and its gate.
 *
 * A synthesis answer may only be committed if it is actually a program. That
 * check no longer needs its own function: `detokenizeCode` repairs the decoded
 * token stream and then parses it, returning null on anything that does not
 * survive - so repair and verdict are the same step, and a lossy recall
 * degrades to silence rather than to a confident falsehood (PARITY §1).
 *
 * SCOPE, load-bearing: the emission path runs only for retrievals whose
 * `slotFlags` are non-zero, i.e. records `processCode` crystallized as CODE
 * patterns. Phase 0.5 fires for every Sink-terminated query and `|-` is the
 * GENERAL inference sink - the whole deduction suite ends its queries with it -
 * so applying a "must parse as JavaScript" rule here unconditionally would
 * silence any English vault recall reaching this fast-path ("socrates is
 * mortal" is not a program). That is the same regression the deduction work
 * already hit when it gated every provenance tier at once
 * (data/benchmarks/README.md, perception-gate scoping); the discriminator is
 * already in the retrieved record, so there is no reason to rediscover it.
 */

/** Content tokens of the query, in order - the caller's concrete operands. */
function _contextTokens(
  ids: Uint32Array,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): string[] {
  return Array.from(ids)
    .filter(id => {
      const c = system.operatorClass[id];
      return (
        c === OperatorClass.None ||
        c === OperatorClass.Action ||
        c === OperatorClass.Arithmetic
      );
    })
    .map(id => atomizer.decodeSequence(new Uint32Array([id]), system).trim())
    .filter(t => t.length > 0);
}

/**
 * Resolves each VAR_N slot of a code pattern to an identifier.
 *
 * PRECEDENCE, and it is the fix rather than a detail: the pattern's OWN stored
 * names win, and query tokens only fill slots the names do not cover.
 *
 * The old order was the other way round - `buildBindings` bound the query's
 * words positionally - which is why asking for `filterPositive` emitted
 * `function filter ( positive ) { ... }`: the words of the *question* were
 * being installed as the function's identifiers. An intent phrase names the
 * thing being asked for; it does not name that thing's parameters, and the only
 * record of what those were called is what ingestion stored.
 *
 * Query tokens remain the fallback rather than being dropped, because a
 * synthesis request CAN legitimately carry operands, and for a pattern
 * crystallized before `var_names` existed they are the only bindings available.
 */
function _slotBindings(
  varNames: string[],
  ids: Uint32Array,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  slotFlags: bigint,
  cache: Cognition.PerceptionCache
): Map<number, string> {
  const bindings = cache.synthesizer.buildBindings(
    _contextTokens(ids, system, atomizer),
    slotFlags
  );
  for (let i = 0; i < varNames.length; i++) {
    if (varNames[i]) bindings.set(i, varNames[i]);
  }
  return bindings;
}

/**
 * Does the retrieved pattern actually answer the question that was asked?
 *
 * A code pattern's slot 0 is the declared function's own name, so a retrieval
 * can be checked against the intent for free: asking for `sumOf` and getting
 * back `startsWith` is a retrieval error, not an answer.
 *
 * This is needed BECAUSE the emission fix worked. All `function <name>` intents
 * crystallize under one abstract signature (`function VAR_0` - measured, 8
 * patterns share it), so the vault discriminates them only by spatial
 * resonance, and a near-miss returns the wrong function. That has always
 * happened; it used to be harmless only because the emission was garbage the
 * parse gate caught. Once emissions became valid programs, a wrong retrieval
 * started committing as a confident falsehood - **parseability is not
 * correctness**, and the repo's own regression guard caught the +1 immediately.
 *
 * Matching is on squashed alphanumerics because the intent surface is
 * `deriveIntent`'s camelCase split ("function sum Of"), while the stored name
 * is the original identifier ("sumOf").
 */
function _answersTheQuestion(
  varNames: string[],
  ids: Uint32Array,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): boolean {
  const declared = varNames[0];
  // No declared name (a body fragment, or a pattern from before var_names
  // existed) - nothing to check against, so this cannot reject it.
  if (!declared) return true;
  const squash = (s: string): string =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = squash(declared);
  if (!wanted) return true;
  // The WHOLE query, not just its content tokens: a function may legitimately
  // be named after an operator word, and `equals` is exactly that - ingestion
  // canonicalizes "=" to "equals", so `function equals` has its own name
  // classified as an operator and filtered out of the content tokens. Asking
  // "is the answer's name present in the question" needs every token; the
  // squash drops the punctuation and the sink for free.
  const asked = squash(atomizer.decodeSequence(ids, system));
  return asked.includes(wanted);
}

async function _resolveCodeSynthesis(
  ids: Uint32Array,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  store: Store,
  cache: Cognition.PerceptionCache,
  opts: {
    /**
     * Only attempt the exact-key vault hit, skipping the attractor-composition
     * fallback. Used by Phase 0a, which is hoisted above vault recall and must
     * therefore commit only on an unambiguous match.
     */
    exactOnly?: boolean;
  } = {}
): Promise<{ ids: Uint32Array; text?: string }> {
  const lastId = ids[ids.length - 1];
  const lookupIds =
    system.operatorClass[lastId] === OperatorClass.Sink
      ? ids.slice(0, -1)
      : ids;
  const direct = await store.checkInterferencePattern(lookupIds);
  if (direct && direct.ids.length > 0) {
    const template = atomizer.decodeSequence(direct.ids, system);
    // slotFlags === 0 means this record is not a code pattern at all (a plain
    // crystallized derivation reaching the same fast-path); leave it alone.
    if (direct.slotFlags === 0n) {
      const ctxTokens = _contextTokens(ids, system, atomizer);
      const inst = cache.synthesizer.instantiate(
        template,
        cache.synthesizer.buildBindings(ctxTokens, direct.slotFlags)
      );
      if (inst && inst !== "unknown")
        return { ids: atomizer.ingestSequence(inst, system) };
    } else if (_answersTheQuestion(direct.varNames, ids, system, atomizer)) {
      const emitted = detokenizeCode(
        template,
        _slotBindings(
          direct.varNames,
          ids,
          system,
          atomizer,
          direct.slotFlags,
          cache
        )
      );
      if (emitted)
        return { ids: atomizer.ingestSequence(emitted, system), text: emitted };
    }
  }
  if (opts.exactOnly)
    return { ids: atomizer.ingestSequence("unknown", system) };
  const attractors: { id: number; posZ: number }[] = [];
  for (let i = 0; i < system.length; i++) {
    if (!system.isAllocated(i)) continue;
    if (system.slotType[i] & (SlotType.Body | SlotType.Condition))
      attractors.push({ id: i, posZ: system.posZ[i] });
  }
  // The composed path selects its attractors BY SlotType (Body/Condition), so
  // everything reaching it is code by construction and the gate needs no
  // slotFlags discriminator here.
  attractors.sort((a, b) => b.posZ - a.posZ);
  const patterns: Code.CodePattern[] = [];
  let composedNames: string[] = [];
  for (const { id } of attractors.slice(0, 6)) {
    const r = await store.checkInterferencePattern(new Uint32Array([id]));
    if (r && r.ids.length > 0) {
      patterns.push({
        template: atomizer.decodeSequence(r.ids, system),
        slotFlags: r.slotFlags,
      });
      // The outer pattern owns the composed template's slot numbering, so its
      // names are the ones that apply; inner patterns are spliced into a Body
      // slot and renumber nothing.
      if (composedNames.length === 0) composedNames = r.varNames;
    }
  }
  if (patterns.length > 0) {
    const composed = cache.synthesizer.compose(patterns);
    const emitted = detokenizeCode(
      composed,
      _slotBindings(
        composedNames,
        ids,
        system,
        atomizer,
        patterns[0].slotFlags,
        cache
      )
    );
    if (emitted)
      return { ids: atomizer.ingestSequence(emitted, system), text: emitted };
  }
  return { ids: atomizer.ingestSequence("unknown", system) };
}

// -- Semantic lookup ---------------------------------------------------------

export function collectSequence(
  startId: number,
  direction: 1 | -1,
  system: Root.ManifoldView
): Uint32Array {
  const ids: number[] = [];
  let k = startId;
  while (k !== 0 && system.isAllocated(k)) {
    if (system.operatorClass[k] !== OperatorClass.None) break;
    if (direction === 1) {
      ids.push(k);
      k = system.PartLayer[k];
    } else {
      ids.unshift(k);
      k = system.ComplexLayer[k];
    }
  }
  return new Uint32Array(ids);
}

function _ensureSpatialIndex(
  system: Root.ManifoldView,
  cache: Cognition.PerceptionCache
): void {
  const n = system.length;
  if (n === cache.lastIndexedLength) return;
  cache.spatialIndex.clear();
  for (let j = 0; j < n; j++)
    cache.spatialIndex.insert(
      j,
      system.posX[j],
      system.posY[j],
      system.posZ[j],
      system.posW[j]
    );
  cache.lastIndexedLength = n;
}

function _getClusterCentroid(
  startId: number,
  direction: 1 | -1,
  system: Root.ManifoldView
) {
  let x = 0,
    y = 0,
    z = 0,
    w = 0,
    totalMass = 0,
    count = 0,
    k = startId;
  while (k !== 0 && system.isAllocated(k)) {
    if (system.operatorClass[k] !== OperatorClass.None) break;
    const m = system.mass[k] || 1.0;
    x += system.posX[k] * m;
    y += system.posY[k] * m;
    z += system.posZ[k] * m;
    w += system.posW[k] * m;
    totalMass += m;
    count++;
    k = direction === 1 ? system.PartLayer[k] : system.ComplexLayer[k];
  }
  if (totalMass > 0) {
    x /= totalMass;
    y /= totalMass;
    z /= totalMass;
    w /= totalMass;
  }
  return { x, y, z, w, totalMass, count };
}

function _resolveMultiTokenSemanticLookup(
  subjectIds: Uint32Array,
  operatorId: number,
  system: Root.ManifoldView,
  cache: Cognition.PerceptionCache
): Uint32Array {
  if (subjectIds.length === 0) return new Uint32Array(0);
  const opScope = system.scope[operatorId],
    opClass = system.operatorClass[operatorId],
    length = system.length;
  const queryIdSet = new Set<number>(subjectIds);
  queryIdSet.add(operatorId);

  for (const { scope0, startId } of [
    ...system.getSequenceEntries(),
  ].reverse()) {
    if (
      queryIdSet.has(startId) ||
      scope0 !== system.scope[subjectIds[0]] ||
      !system.isAllocated(startId)
    )
      continue;
    let match = true;
    for (let j = 0; j < subjectIds.length; j++) {
      const cId = startId + j;
      if (
        cId >= length ||
        !system.isAllocated(cId) ||
        system.scope[cId] !== system.scope[subjectIds[j]]
      ) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const opId = startId + subjectIds.length;
    if (opId < length && system.scope[opId] === opScope) {
      const next = system.PartLayer[opId];
      if (next !== 0 && system.isAllocated(next))
        return collectSequence(next, 1, system);
    }
  }

  for (const i of system.getIdsByScope(system.scope[subjectIds[0]])) {
    if (queryIdSet.has(i)) continue;
    let match = true,
      curr = i;
    for (let j = 0; j < subjectIds.length; j++) {
      if (
        curr === 0 ||
        !system.isAllocated(curr) ||
        system.scope[curr] !== system.scope[subjectIds[j]]
      ) {
        match = false;
        break;
      }
      if (j < subjectIds.length - 1) curr = system.PartLayer[curr];
    }
    if (!match) continue;
    const opId = system.PartLayer[curr];
    if (
      opId !== 0 &&
      system.isAllocated(opId) &&
      system.scope[opId] === opScope
    )
      return collectSequence(system.PartLayer[opId], 1, system);
  }

  if (opClass === OperatorClass.IdentityShift) {
    for (const i of system.getIdsByScope(opScope)) {
      if (queryIdSet.has(i)) continue;
      let match = true,
        curr = system.PartLayer[i];
      for (let j = 0; j < subjectIds.length; j++) {
        if (
          curr === 0 ||
          !system.isAllocated(curr) ||
          system.scope[curr] !== system.scope[subjectIds[j]]
        ) {
          match = false;
          break;
        }
        curr = system.PartLayer[curr];
      }
      if (match) return collectSequence(system.ComplexLayer[i], -1, system);
    }
  }

  let subX = 0,
    subY = 0,
    subZ = 0,
    subW = 0,
    subMass = 0;
  for (let i = 0; i < subjectIds.length; i++) {
    const id = subjectIds[i],
      m = system.mass[id] || 1.0;
    subX += system.posX[id] * m;
    subY += system.posY[id] * m;
    subZ += system.posZ[id] * m;
    subW += system.posW[id] * m;
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
    const id = subjectIds[i],
      dx = system.posX[id] - subX,
      dy = system.posY[id] - subY,
      dz = system.posZ[id] - subZ,
      dw = system.posW[id] - subW;
    variance += dx * dx + dy * dy + dz * dz + dw * dw;
  }
  const dynThr = Math.max(5.0, variance * 2.0);
  _ensureSpatialIndex(system, cache);
  const candidates = cache.spatialIndex.candidatesInRadius(
    subX,
    subY,
    subZ,
    subW,
    Math.sqrt(dynThr)
  );
  const results: { ids: Uint32Array; score: number }[] = [];
  for (const i of candidates) {
    if (queryIdSet.has(i)) continue;
    const oc = system.operatorClass[i];
    if (oc === opClass && system.scope[i] === opScope) {
      const memSub = _getClusterCentroid(system.ComplexLayer[i], -1, system);
      if (memSub.count > 0) {
        const dx = memSub.x - subX,
          dy = memSub.y - subY,
          dz = memSub.z - subZ,
          dw = memSub.w - subW,
          d2 = dx * dx + dy * dy + dz * dz + dw * dw;
        if (d2 < dynThr)
          results.push({
            ids: collectSequence(system.PartLayer[i], 1, system),
            score: d2,
          });
      }
      if (oc === OperatorClass.IdentityShift) {
        const memObj = _getClusterCentroid(system.PartLayer[i], 1, system);
        if (memObj.count > 0) {
          const dx = memObj.x - subX,
            dy = memObj.y - subY,
            dz = memObj.z - subZ,
            dw = memObj.w - subW,
            d2 = dx * dx + dy * dy + dz * dz + dw * dw;
          if (d2 < dynThr)
            results.push({
              ids: collectSequence(system.ComplexLayer[i], -1, system),
              score: d2 * 0.1,
            });
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

async function _resolveSemanticDerivation(
  ids: Uint32Array,
  deps: Cognition.PerceptionDeps
): Promise<Uint32Array | null> {
  const { system, atomizer, store } = deps;
  if (store) {
    const hit = await store.checkInterferencePattern(ids);
    if (hit && hit.ids.length > 0) return hit.ids;
    const N = ids.length,
      lastClass = N > 0 ? system.operatorClass[ids[N - 1]] : OperatorClass.None;
    if (
      lastClass === OperatorClass.IdentityShift ||
      lastClass === OperatorClass.Action
    ) {
      const sinkScope = atomizer?.getSymbolScope("|-", false) ?? 0;
      if (sinkScope > 0) {
        const sinkId = [...system.getIdsByScope(sinkScope)].find(
          id =>
            system.isAllocated(id) &&
            system.operatorClass[id] === OperatorClass.Sink
        );
        if (sinkId !== undefined) {
          const sh = await store.checkInterferencePattern(
            new Uint32Array([...ids, sinkId])
          );
          if (sh && sh.ids.length > 0) return sh.ids;
        }
      }
    }
  }
  const text = atomizer.decodeSequence(ids, system);
  const doc = nlp(text);
  const verbs = doc.verbs().out("array"),
    dates = doc.match("#Date").out("array");
  if (verbs.length > 0 && dates.length > 0) {
    const verb = verbs[0],
      date = dates[0];
    const verbScope = atomizer.getSymbolScope(verb, false),
      impliesScope = atomizer.getSymbolScope("implies", false),
      creationScope = atomizer.getSymbolScope("creation", false);
    const _mem = (s: number, o: number, p: number) => {
      for (let i = 0; i < system.length - 2; i++)
        if (
          system.scope[i] === s &&
          system.scope[i + 1] === o &&
          system.scope[i + 2] === p
        )
          return true;
      return false;
    };
    if (_mem(verbScope, impliesScope, creationScope)) {
      const ot = doc.match(`${verb} [*]`).out("array");
      if (ot.length > 0) {
        const os = ot[0].replace(verb, "").replace(/\|-/g, "").trim();
        if (os)
          return atomizer.ingestSequence(
            `then ${os} did not exist before ${date}`,
            system
          );
      }
    } else {
      let subjectScope = -1,
        objectScope = -1,
        subjectStr = "",
        objectStr = "";
      for (let i = 0; i < ids.length - 2; i++) {
        if (system.scope[ids[i + 1]] === verbScope) {
          subjectScope = system.scope[ids[i]];
          objectScope = system.scope[ids[i + 2]];
          subjectStr = atomizer.decodeSequence(
            new Uint32Array([ids[i]]),
            system
          );
          objectStr = atomizer.decodeSequence(
            new Uint32Array([ids[i + 2]]),
            system
          );
          break;
        }
      }
      if (subjectScope !== -1 && objectScope !== -1) {
        let evs = -1;
        for (let i = 0; i < system.length - 2; i++)
          if (
            system.scope[i] === subjectScope &&
            system.scope[i + 2] === objectScope &&
            system.mass[i + 1] === system.c ** 2
          ) {
            evs = system.scope[i + 1];
            break;
          }
        if (
          evs !== -1 &&
          evs !== verbScope &&
          _mem(evs, impliesScope, creationScope)
        ) {
          const infVerb =
            nlp(verb).verbs().toInfinitive().out("array")[0] || verb;
          return atomizer.ingestSequence(
            `then ${subjectStr} did not ${infVerb} ${objectStr}`,
            system
          );
        }
      }
    }
  }
  return null;
}
