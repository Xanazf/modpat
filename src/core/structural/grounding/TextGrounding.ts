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
import { placeGraphAnchored } from "./StructuralGrounding";

/**
 * Resolves a label's existing precept: prefer a structurally-grounded one,
 * else the most massive allocated candidate. Returns -1 when none exists.
 */
function resolveExisting(system: Root.ManifoldView, scope: number): number {
  if (scope <= 0) return -1;
  let best = -1;
  let bestMass = Number.NEGATIVE_INFINITY;
  for (const id of system.getIdsByScope(scope)) {
    if (!system.isAllocated(id)) continue;
    if (system.groundedPrecepts.has(id)) return id;
    if (system.mass[id] > bestMass) {
      bestMass = system.mass[id];
      best = id;
    }
  }
  return best;
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

  // WaveResolver contract: a NEW member of a contrast pair sits at the exact
  // antipode (mirror through origin) of its partner, giving cos = -1.
  for (const c of graph.contrasts ?? []) {
    const aId = nodeToPrecept[c.a];
    const bId = nodeToPrecept[c.b];
    if (aId < 0 || bId < 0) continue;
    const aPinned = pinned.has(c.a);
    const bPinned = pinned.has(c.b);
    if (aPinned && bPinned) continue;
    const [moved, anchor] = aPinned ? [bId, aId] : [aId, bId];
    system.posX[moved] = -system.posX[anchor];
    system.posY[moved] = -system.posY[anchor];
    system.posZ[moved] = -system.posZ[anchor];
    system.update(moved, "text-ground");
  }

  return { graph, nodeToPrecept, labelToPrecept, placement, reused, created };
}
