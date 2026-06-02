/**
 * Perception – the Observe → Follow → Read pipeline as a plain function module.
 *
 * All functions take their dependencies explicitly. Mutable cache state
 * (semantic spatial index, synthesizer) is bundled in PerceptionCache, which
 * the Traveler creates once and passes on every call.
 */

import { DOPAT_CONFIG } from "@config";
import { resolveLogicFormula } from "@core_i/formula/E1Formula";
import { OperatorClass, SlotType } from "@core_i/System";
import type { ManifoldLifecycle } from "@core_s/ManifoldLifecycle";
import type Store from "@core_s/Memory";
import { metrics } from "@core_s/Metrics";
import { type FrameworkId, resolveActiveAtoms } from "@mutate/FrameworkIndex";
import { GridIndex4D } from "@mutate/GridIndex4D";
import { type CodePattern, Synthesizer } from "@skill_code/Coder";
import { gateEmit } from "@skill_cogi/Coherence";
import {
  parseIsFacts,
  reduceAdditive,
  reduceEntailment,
} from "@skill_cogi/Reduction";
import type { Language } from "@skill_lang/Language";
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

/** Everything perception needs from the Traveler. */
export interface PerceptionDeps {
  readonly system: Root.ManifoldView;
  readonly atomizer: Atomic.Engine;
  store: Store | null;
  language: Language | null;
  lifecycle: ManifoldLifecycle | null;
  /** The locomotion grid index, already built by buildGridIndex(). */
  readonly gridIndex: GridIndex4D;
  buildGridIndex(): void;
  traverse(
    src: number,
    tgt: number,
    opts: Mapping.RouteOptions
  ): Promise<Uint32Array>;
  getMetricForce(
    px: number,
    py: number,
    pz: number,
    pw: number,
    pens: any[],
    boost: Set<number> | undefined,
    activeAtoms?: Set<number>
  ): [V: number, fx: number, fy: number, fz: number, fw: number];
  boostAtomMasses(ids: Uint32Array): void;
  readonly position: [number, number, number, number];
  readonly activeFrameworks: Set<FrameworkId>;
  readonly lastInferentialEffort: number;
}

/** Mutable cache owned by the Traveler and passed into perception calls. */
export interface PerceptionCache {
  spatialIndex: GridIndex4D;
  lastIndexedLength: number;
  readonly synthesizer: Synthesizer;
}

export function makePerceptionCache(): PerceptionCache {
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
  deps: PerceptionDeps,
  cache: PerceptionCache,
  maxLen: number
): Promise<{ ids: Uint32Array; sinkStrength: number }> {
  if (ids.length > maxLen) {
    throw new Error(
      `Sequence length ${ids.length} exceeds max DOD buffer capacity ${maxLen}`
    );
  }
  const result = await observeSettlingGradient(ids, opts, deps, cache);
  if (!opts.gated || result.ids.length === 0) return result;

  // Phase 2 emission gate. "unknown" is already an abstain, pass it through.
  const decoded = deps.atomizer
    .decodeSequence(result.ids, deps.system)
    .trim()
    .toLowerCase();
  if (decoded === "unknown") return result;

  deps.buildGridIndex();
  const verdict = gateEmit(
    ids,
    result.ids,
    deps.system,
    deps.gridIndex,
    deps.lastInferentialEffort
  );
  if (verdict.emit) return result;
  return {
    ids: deps.atomizer.ingestSequence("unknown", deps.system),
    sinkStrength: 0,
  };
}

export async function perceiveCapturing(
  ids: Uint32Array,
  opts: PerceptionOptions,
  deps: PerceptionDeps,
  cache: PerceptionCache,
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
  },
  deps: PerceptionDeps,
  cache: PerceptionCache,
  maxLen: number
): Promise<CoherentResult> {
  const r = await observeSettlingGradient(
    ids,
    { contextScopes: opts.contextScopes, probeMode: opts.probeMode },
    deps,
    cache
  );
  const coherence = Math.max(0, 1 - deps.lastInferentialEffort);
  return {
    ids: r.ids,
    coherence,
    iterations: 1,
    learned: [],
    diagnosis: r.ids.length > 0 ? "coherent" : "void",
    diagnostics: null,
  };
}

// -- Observe → Follow → Read ------------------------------------------------

export async function observeSettlingGradient(
  ids: Uint32Array,
  opts: PerceptionOptions,
  deps: PerceptionDeps,
  cache: PerceptionCache
): Promise<{ ids: Uint32Array; sinkStrength: number }> {
  if (ids.length === 0) return { ids: new Uint32Array(0), sinkStrength: 0 };
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

  // Phase 0b: vault recall
  if (!opts.probeMode) {
    const derivation = await _resolveSemanticDerivation(ids, deps);
    if (derivation) {
      if (store) {
        boostAtomMasses(ids);
        boostAtomMasses(derivation);
      }
      return { ids: derivation, sinkStrength: 1.0 };
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
      return { ids: reduct, sinkStrength: 1.0 };
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
      return { ids: topoResult, sinkStrength: 1.0 };
    }
  }

  // Phase E1: fuzzy connective formula resolution
  if (!opts.probeMode) {
    const e1Result = resolveLogicFormula(ids, system);
    if (e1Result !== null && e1Result.length > 0) {
      if (store) {
        await store.crystallizeProof(ids, e1Result, 1.0);
        boostAtomMasses(ids);
        boostAtomMasses(e1Result);
      }
      return { ids: e1Result, sinkStrength: 1.0 };
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
    const decoded = atomizer.decodeSequence(synth, system).trim();
    if (decoded && decoded !== "unknown")
      return { ids: synth, sinkStrength: 0 };
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
    return { ids: atomizer.ingestSequence("unknown", system), sinkStrength: 0 };

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
    return { ids: atomizer.ingestSequence("unknown", system), sinkStrength: 0 };

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
    };
  }

  // Read: traverse source → sink
  metrics.increment("perception.geodesic");
  const result = await traverse(sourceId, sinkId, {
    boostScopes: effectiveBoost,
    activeAtoms,
  });
  return { ids: result, sinkStrength: 0 };
}

// -- Settling helpers --------------------------------------------------------

export function settleAtoms(
  ids: Uint32Array,
  driftTargets: Map<number, readonly [number, number, number, number]>,
  boost: Set<number> | undefined,
  activeAtoms: Set<number> | undefined,
  deps: PerceptionDeps
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
  deps: PerceptionDeps
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
 *   2) universal instantiation - Sink-terminated query whose premises form an
 *      IS-graph; reduceEntailment walks it from the subject. Fires only when
 *      a rule was applied (hop >= 2), so it cannot regress transitivity
 *      cases (where the subject is a chain end with no outgoing edges).
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
  const facts = parseIsFacts(text);
  if (facts.length === 0) return null;

  const r = reduceEntailment(subject, facts);
  if (r.derived.length === 0) return null;

  // Deepest-hop derivation wins - it represents the longest applied chain of
  // rules and is the genuinely downstream conclusion.
  let best = r.derived[0];
  let bestHop = r.hops.get(best) ?? 0;
  for (const c of r.derived) {
    const h = r.hops.get(c) ?? 0;
    if (h > bestHop) {
      best = c;
      bestHop = h;
    }
  }
  return atomizer.ingestSequence(best, system);
}

// -- Code synthesis ----------------------------------------------------------

async function _resolveCodeSynthesis(
  ids: Uint32Array,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  store: Store,
  cache: PerceptionCache
): Promise<Uint32Array> {
  const lastId = ids[ids.length - 1];
  const lookupIds =
    system.operatorClass[lastId] === OperatorClass.Sink
      ? ids.slice(0, -1)
      : ids;
  const direct = await store.checkInterferencePattern(lookupIds);
  if (direct && direct.ids.length > 0) {
    const template = atomizer.decodeSequence(direct.ids, system);
    const ctxTokens = Array.from(ids)
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
    const inst = cache.synthesizer.instantiate(
      template,
      cache.synthesizer.buildBindings(ctxTokens, direct.slotFlags)
    );
    if (inst && inst !== "unknown")
      return atomizer.ingestSequence(inst, system);
  }
  const attractors: { id: number; posZ: number }[] = [];
  for (let i = 0; i < system.length; i++) {
    if (!system.isAllocated(i)) continue;
    if (system.slotType[i] & (SlotType.Body | SlotType.Condition))
      attractors.push({ id: i, posZ: system.posZ[i] });
  }
  attractors.sort((a, b) => b.posZ - a.posZ);
  const patterns: CodePattern[] = [];
  for (const { id } of attractors.slice(0, 6)) {
    const r = await store.checkInterferencePattern(new Uint32Array([id]));
    if (r && r.ids.length > 0)
      patterns.push({
        template: atomizer.decodeSequence(r.ids, system),
        slotFlags: r.slotFlags,
      });
  }
  if (patterns.length > 0) {
    const composed = cache.synthesizer.compose(patterns);
    const ctxTokens = Array.from(ids)
      .map(id => atomizer.decodeSequence(new Uint32Array([id]), system).trim())
      .filter(t => t.length > 0);
    const inst = cache.synthesizer.instantiate(
      composed,
      cache.synthesizer.buildBindings(ctxTokens, patterns[0].slotFlags)
    );
    if (inst && inst !== "unknown")
      return atomizer.ingestSequence(inst, system);
  }
  return atomizer.ingestSequence("unknown", system);
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
  cache: PerceptionCache
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
  cache: PerceptionCache
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
  deps: PerceptionDeps
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
