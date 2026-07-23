/**
 * TextGrounding - lands a TextGraph into the LIVE System without disturbing
 * existing geometry (the landing layer for grammar-grounded ingestion,
 * PARITY §3.1 route (a)).
 *
 * Deltas vs `groundGraphIntoSystem` (AstGrounding.ts), which unconditionally
 * creates one precept per label and is only safe on a fresh System:
 *
 *   - DEDUPE BY SCOPE, PIN, NEVER MOVE. A label that already resolves to an
 *     allocated precept is reused as an immovable anchor: its coordinates are
 *     pinned and the new nodes relax into its metric frame
 *     (`placeGraphAnchored`). This - not threshold recalibration - is what
 *     preserves the geometry contracts: numerals' posW IS their value
 *     (reduceAdditive), antonym antipodes (WaveResolver), code symbols.
 *   - EXACT ANTIPODE for new contrast members. The SMACOF stance-Z offset
 *     cannot guarantee WaveResolver's cos < -0.999, so a newly created member
 *     of a contrast pair is mirrored through the origin against its partner.
 *     Pairs whose members both pre-exist are left alone (applyLexicalAntonymStance
 *     or prior ingestion already own them).
 *   - "text-ground" UPDATE TAG (not "ast-ground"): landed precepts stay OUT
 *     of `system.groundedPrecepts`, so the cold-start co-occurrence basis
 *     keeps its selective trigger (see the documented regression in
 *     config.ts COLD_START_COOCCURRENCE_ENABLED). Positions still reach
 *     future language tokens via the DIRECT referent path
 *     (REFERENT_GROUNDING_ENABLED, structuralOnly=false).
 */

import { DOPAT_CONFIG } from "@config";
import logger from "@utils/SpectralLogger";
import { placeGraphAnchored } from "./StructuralGrounding";
import { buildGraphFromText } from "./TextGraph";

/**
 * Resolves a label's existing precept: prefer a structurally-grounded one,
 * then this channel's own prior anchor, else the most massive allocated
 * candidate. Returns -1 when none exists.
 *
 * The text-ground check matters because the SAME scope is shared with
 * Language's raw per-token ingestion (every processed sentence tokenizes
 * independently via atomizer.ingestSequence, regardless of grounding). A
 * raw token precept can incidentally out-mass this channel's own anchor,
 * and picking it here would silently attach new edges/contrasts to a
 * precept invisible to the ledger, fracturing the relational chain without
 * any error (measured: "cats are not fish" landed its contrast on a raw
 * "cat" token instead of the anchor "felix is a cat" pointed at, making the
 * fact ledger-unreachable from felix).
 */
function resolveExisting(system: Root.ManifoldView, scope: number): number {
  if (scope <= 0) return -1;
  let best = -1;
  let bestMass = Number.NEGATIVE_INFINITY;
  for (const id of system.getIdsByScope(scope)) {
    if (!system.isAllocated(id)) continue;
    if (system.groundedPrecepts.has(id)) return id;
    if (system.textGroundedPrecepts.has(id)) return id;
    if (system.mass[id] > bestMass) {
      bestMass = system.mass[id];
      best = id;
    }
  }
  return best;
}

/**
 * Flag-gated convenience wrapper shared by every text-grounding call site
 * (Language.ingestAssertion, Unfolder.ingestContent, benchmark fast mode):
 * parse `text` into a TextGraph and land it, applying the same minimum-signal
 * gate everywhere (>= 2 nodes and >= 1 edge/contrast - a bag of unrelated
 * tokens carries no relational geometry worth landing). Never throws: a parse
 * or landing failure is logged and swallowed so ingestion always proceeds.
 * Returns the grounding result, or null when gated off / skipped / failed.
 */
export function groundTextIfEnabled(
  text: string | string[],
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  opts: Grounding.GroundingOptions = {}
): Grounding.TextGroundingResult | null {
  if (!DOPAT_CONFIG.PHYSICS.TEXT_GRAPH_INGESTION_ENABLED) return null;
  system.textGroundedSentences++;
  try {
    const graph = buildGraphFromText(text);
    if (
      graph.nodes.length < 2 ||
      graph.edges.length + (graph.contrasts?.length ?? 0) < 1
    ) {
      // Nothing landed: this input is invisible to the ledger, so the
      // closed-world valve must know the theory is incompletely read.
      system.textGroundedUnparsed++;
      return null;
    }
    return groundTextGraphIntoSystem(graph, system, atomizer, opts);
  } catch (e) {
    logger.error("[TextGraph] grounding failed:", e);
    system.textGroundedUnparsed++;
    return null;
  }
}

export function groundTextGraphIntoSystem(
  graph: Grounding.GroundGraph,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  opts: Grounding.GroundingOptions = {}
): Grounding.TextGroundingResult {
  const n = graph.nodes.length;
  const nodeToPrecept = new Int32Array(n).fill(-1);
  const labelToPrecept = new Map<string, number>();
  const reused = new Map<string, number>();
  const created = new Map<string, number>();
  const pinned = new Map<number, readonly [number, number, number, number]>();

  for (let i = 0; i < n; i++) {
    const label = graph.nodes[i].label;
    let id = labelToPrecept.get(label);
    if (id === undefined) {
      const scope = atomizer.getSymbolScope(label, false);
      const existing = resolveExisting(system, scope);
      if (existing >= 0) {
        id = existing;
        reused.set(label, id);
      } else {
        id = system.createLocation(system.c, scope, "text-ground");
        created.set(label, id);
      }
      labelToPrecept.set(label, id);
    }
    nodeToPrecept[i] = id;
    if (reused.has(label)) {
      pinned.set(i, [
        system.posX[id],
        system.posY[id],
        system.posZ[id],
        system.posW[id],
      ]);
    }
  }

  if (n === 0) {
    return {
      graph,
      nodeToPrecept,
      labelToPrecept,
      placement: null,
      reused,
      created,
    };
  }

  const placement = placeGraphAnchored(graph, pinned, opts);

  // All-fresh fact-sets have no frame to inherit - spread by the measured
  // scale knob (a no-op at the default 1.0).
  const scale =
    pinned.size === 0 ? DOPAT_CONFIG.PHYSICS.TEXT_GRAPH_SPATIAL_SCALE : 1.0;

  // In-degree -> mass, created precepts only.
  const inDegree = new Float64Array(n).fill(1);
  for (const e of graph.edges) inDegree[e.to] += 1;

  for (let i = 0; i < n; i++) {
    const id = nodeToPrecept[i];
    if (id < 0 || pinned.has(i) || !system.isAllocated(id)) continue;
    system.posX[id] = placement.x[i] * scale;
    system.posY[id] = placement.y[i] * scale;
    system.posZ[id] = placement.z[i] * scale;
    // W is the number line, never spatially scaled.
    system.posW[id] = placement.w[i];
    system.mass[id] = system.c * inDegree[i];
    system.update(id, "text-ground");
  }

  // Register EVERY node precept (created and reused-pinned alike) in the
  // text-ground registry: the graph-query readout walks exactly the geometry
  // this channel landed on purpose, and a reused anchor is as much a part of
  // that relational frame as a fresh node. NOT groundedPrecepts - see header.
  for (let i = 0; i < n; i++) {
    const id = nodeToPrecept[i];
    if (id >= 0 && system.isAllocated(id)) system.textGroundedPrecepts.add(id);
  }

  // Explicit relational ledger (GraphQuery's read side): record every edge
  // of THIS graph, mirrored, regardless of whether its endpoints are new or
  // reused-pinned - a reused anchor gaining a new asserted neighbour is
  // exactly the case that must show up in the ledger. Recorded unconditional
  // of placement/scale so it never depends on absolute geometry.
  const addLedger = (
    ledger: Map<number, Set<number>>,
    aId: number,
    bId: number
  ): void => {
    if (aId < 0 || bId < 0 || aId === bId) return;
    let aSet = ledger.get(aId);
    if (!aSet) {
      aSet = new Set();
      ledger.set(aId, aSet);
    }
    aSet.add(bId);
    let bSet = ledger.get(bId);
    if (!bSet) {
      bSet = new Set();
      ledger.set(bId, bSet);
    }
    bSet.add(aId);
  };
  for (const e of graph.edges) {
    const fromId = nodeToPrecept[e.from];
    const toId = nodeToPrecept[e.to];
    addLedger(system.textGroundedEdges, fromId, toId);
    // Directed companion: ASSERTED edges only, asserted direction only.
    // GraphQuery chains over this, so two exclusions apply: reversed
    // questions must not affirm (no mirror), and rule content must not
    // affirm ("if X then the dog is green" lands hypothetical edges -
    // measured 2026-07-21: chaining through them turned 15 open-world
    // unknowns into confident falsehoods on the honest ProofWriter run).
    if (e.hypothetical || e.pairScoped) continue;
    if (fromId >= 0 && toId >= 0 && fromId !== toId) {
      let outSet = system.textGroundedEdgesOut.get(fromId);
      if (!outSet) {
        outSet = new Set();
        system.textGroundedEdgesOut.set(fromId, outSet);
      }
      outSet.add(toId);
    }
  }

  // WaveResolver contract: a NEW member of a contrast pair sits at the exact
  // antipode (mirror through origin) of its partner, giving cos = -1.
  for (const c of graph.contrasts ?? []) {
    const aId = nodeToPrecept[c.a];
    const bId = nodeToPrecept[c.b];
    if (aId < 0 || bId < 0) continue;
    // Rule-scope negation ("if X then Y is not Z") shapes placement below
    // but must not back ledger DENIALS - same asserted-content contract as
    // the directed edge map.
    if (!c.hypothetical && !c.pairScoped)
      addLedger(system.textGroundedContrasts, aId, bId);
    const aPinned = pinned.has(c.a);
    const bPinned = pinned.has(c.b);
    if (aPinned && bPinned) continue;
    const [moved, anchor] = aPinned ? [bId, aId] : [aId, bId];
    system.posX[moved] = -system.posX[anchor];
    system.posY[moved] = -system.posY[anchor];
    system.posZ[moved] = -system.posZ[anchor];
    system.update(moved, "text-ground");
  }

  // Rule ledger: precept-resolve each extracted attribute rule (subject -1 =
  // the bound variable, preserved as -1). Rules assert nothing here - they
  // are discharged by GraphQuery in a transient per-query closure - so a
  // rule with any unresolvable atom is dropped whole rather than landed
  // partially. Deduped against the live ledger by canonical key.
  if (graph.rules?.length) {
    const atomKey = (x: Grounding.TextRuleAtom) =>
      `${x.subject}:${x.verb ?? -1}:${x.predicate}:${x.negated ? 1 : 0}`;
    const existing = new Set(
      system.textGroundedRules.map(
        r =>
          `${r.conditions.map(atomKey).sort().join("&")}=>${atomKey(r.conclusion)}`
      )
    );
    const resolveAtom = (
      a: Grounding.RuleAtom
    ): Grounding.TextRuleAtom | null => {
      const subject = a.subject < 0 ? -1 : nodeToPrecept[a.subject];
      const predicate = nodeToPrecept[a.predicate];
      const verb = a.verb === undefined ? undefined : nodeToPrecept[a.verb];
      if (predicate < 0 || (a.subject >= 0 && subject < 0)) return null;
      if (verb !== undefined && verb < 0) return null;
      return { subject, predicate, verb, negated: a.negated };
    };
    for (const rule of graph.rules) {
      const conclusion = resolveAtom(rule.conclusion);
      if (!conclusion) continue;
      const conditions: Grounding.TextRuleAtom[] = [];
      for (const c of rule.conditions) {
        const atom = resolveAtom(c);
        if (!atom) break;
        conditions.push(atom);
      }
      if (conditions.length !== rule.conditions.length) continue;
      const key = `${conditions.map(atomKey).sort().join("&")}=>${atomKey(conclusion)}`;
      if (existing.has(key)) continue;
      existing.add(key);
      system.textGroundedRules.push({ conditions, conclusion });
    }
  }

  // Pair-exact SVO ledgers: dedup is free via the Set keys.
  for (const t of graph.triples ?? []) {
    const s = nodeToPrecept[t.subject];
    const v = nodeToPrecept[t.verb];
    const o = nodeToPrecept[t.object];
    if (s < 0 || v < 0 || o < 0) continue;
    (t.negated
      ? system.textGroundedTriplesNeg
      : system.textGroundedTriples
    ).add(`${s}|${v}|${o}`);
    system.textGroundedTripleParticipants.add(s);
    system.textGroundedTripleParticipants.add(v);
    system.textGroundedTripleParticipants.add(o);
  }

  return { graph, nodeToPrecept, labelToPrecept, placement, reused, created };
}
