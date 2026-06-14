/**
 * SurveyLoopRunner - the survey loop wired into the live System.
 *
 * Phase 4.5 proved the loop in isolation (predict -> evaluate -> localize ->
 * repair -> re-validate). This module runs it AGAINST THE RUNNING MANIFOLD, as a
 * tick `learnCycle` calls: it re-points reinforcement from usage to ground truth,
 * eroding terrain defects by contact with the territory rather than by the
 * map-maker's habit.
 *
 * A `GroundTruthChannel` is a territory the loop can check the terrain against.
 * Two kinds, and the difference is the whole point of the influence bench:
 *   - SELF-supplied (`arithmeticSelfChannel`): the system invents its own checks
 *     (expressions on its grounded number line) and evaluates them for free - no
 *     authoring, unbounded supply, but it only reaches the domain where the
 *     homomorphism is exact and the answer is computable.
 *   - KB-supplied (`closedWorldKbChannel`): an authored knowledge base whose
 *     closed-world consequences are the truth - it reaches relational / taxonomic
 *     terrain the self channel cannot, but every fact must be authored.
 *
 * Pure orchestration over the existing channel mechanisms; no DB, no GPU.
 */

import { parseNumericLabel } from "@core_s/helpers/functions";
import { behaviouralFidelity, surveyLoop } from "./BehaviouralFidelity";
import {
  closedWorldFidelity,
  closedWorldModel,
  closedWorldSurveyLoop,
} from "./ClosedWorldFidelity";

// -- Numeral discovery (what the self channel can check) ----------------------

/**
 * Finds the integer-valued precepts already in the manifold, keyed by value.
 * The self channel needs no external input: it reads the number line the System
 * already grounded and generates its own problems over it.
 */
export function discoverNumerals(
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): Map<number, number> {
  const found = new Map<number, number>();
  for (let id = 0; id < system.length; id++) {
    if (!system.isAllocated(id)) continue;
    const label = atomizer.decodeSequence(new Uint32Array([id]), system).trim();
    const value = parseNumericLabel(label);
    if (value === null || !Number.isInteger(value)) continue;
    // First precept for a value wins (deterministic; duplicates are reducts).
    if (!found.has(value)) found.set(value, id);
  }
  return found;
}

// -- Self-supplied channel: arithmetic the system checks for free -------------

/**
 * A self-supplied ground-truth channel: it discovers the manifold's numerals,
 * generates additive expressions over them, predicts each reduct by composing
 * grounded W positions, and checks against evaluation (free). Any drifted
 * numeral is localized and re-placed on the number line - territory-correction
 * with zero authoring.
 */
export function arithmeticSelfChannel(
  options: { numerals?: Map<number, number>; maxRepairs?: number } = {}
): Grounding.GroundTruthChannel {
  return {
    name: "arithmetic-self",
    source: "self",
    run(system, atomizer) {
      const numerals = options.numerals ?? discoverNumerals(system, atomizer);
      const values = [...numerals.keys()].sort((a, b) => a - b);
      const exprs: string[] = [];
      for (const a of values) {
        for (const b of values) {
          exprs.push(`${a} + ${b}`);
          if (a - b >= 0) exprs.push(`${a} - ${b}`);
        }
      }
      if (exprs.length === 0) {
        return {
          name: "arithmetic-self",
          source: "self",
          fidelityBefore: 1,
          fidelityAfter: 1,
          repairs: 0,
          groundTruthUnits: 0,
        };
      }
      const loop = surveyLoop(exprs, system, atomizer, {
        maxRepairs: options.maxRepairs ?? 8,
      });
      return {
        name: "arithmetic-self",
        source: "self",
        fidelityBefore: loop.before.fidelity,
        fidelityAfter: loop.after.fidelity,
        repairs: loop.repairs.length,
        groundTruthUnits: exprs.length, // free, self-generated
      };
    },
  };
}

// -- KB-supplied channel: a closed-world model over an authored KB ------------

/** Reads the live precept coordinates for a grounded KB graph into a Placement. */
function readPlacement(
  graph: Grounding.GroundGraph,
  system: Root.ManifoldView,
  nodeToPrecept: Int32Array
): Grounding.Placement {
  const n = graph.nodes.length;
  const p: Grounding.Placement = {
    x: new Float64Array(n),
    y: new Float64Array(n),
    z: new Float64Array(n),
    w: new Float64Array(n),
    mass: new Float64Array(n).fill(1),
  };
  for (let i = 0; i < n; i++) {
    const pid = nodeToPrecept[i];
    if (pid < 0 || !system.isAllocated(pid)) continue;
    p.x[i] = system.posX[pid];
    p.y[i] = system.posY[pid];
    p.z[i] = system.posZ[pid];
    p.w[i] = system.posW[pid];
    p.mass[i] = system.mass[pid];
  }
  return p;
}

/**
 * A KB-supplied ground-truth channel: the closed-world model of an authored KB
 * (`graph`, already grounded into the System with the `nodeToPrecept` map from
 * `groundGraphIntoSystem`) is the territory. It reads the live coordinates,
 * runs the closed-world survey loop, and writes each re-placement back to the
 * precept it corrected (locality of writes). The authoring cost is the KB's
 * reference relations - the cost axis the bench charges against this channel.
 */
export function closedWorldKbChannel(
  graph: Grounding.GroundGraph,
  nodeToPrecept: Int32Array,
  options: { maxRepairs?: number; name?: string } = {}
): Grounding.GroundTruthChannel {
  const model = closedWorldModel(graph);
  const authoredRelations = graph.edges.filter(e => e.from !== e.to).length;
  const name = options.name ?? "closed-world-kb";
  return {
    name,
    source: "kb",
    run(system, _atomizer) {
      const p = readPlacement(graph, system, nodeToPrecept);
      const before = closedWorldFidelity(graph, p, model);
      const loop = closedWorldSurveyLoop(graph, p, {
        model,
        maxRepairs: options.maxRepairs ?? 8,
      });
      // Write each re-placement back to its live precept (only repaired nodes).
      for (const r of loop.repairs) {
        const pid = nodeToPrecept[r.id];
        if (pid < 0 || !system.isAllocated(pid)) continue;
        system.posX[pid] = p.x[r.id];
        system.posY[pid] = p.y[r.id];
        system.posZ[pid] = p.z[r.id];
        system.update(pid, "survey-repair");
      }
      return {
        name,
        source: "kb",
        fidelityBefore: before.fidelity,
        fidelityAfter: loop.after.fidelity,
        repairs: loop.repairs.length,
        groundTruthUnits: authoredRelations, // authored cost
      };
    },
  };
}

// -- The tick: run every registered channel against the live System -----------

/**
 * Runs each ground-truth channel against the live System, repairing terrain in
 * place. This is what `Traveler.learnCycle` calls when the survey loop is
 * enabled - the loop made continuous, on its own, rather than a diagnostic.
 */
export function runSurveyTick(
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  channels: Grounding.GroundTruthChannel[]
): Grounding.SurveyTickReport {
  const reports: Grounding.ChannelReport[] = [];
  let totalRepairs = 0;
  for (const channel of channels) {
    const r = channel.run(system, atomizer);
    reports.push(r);
    totalRepairs += r.repairs;
  }
  return { channels: reports, totalRepairs };
}

/**
 * Closed-world fidelity of a grounded KB against the LIVE precept coordinates -
 * a measure-only probe (no repair) for the bench and guards.
 */
export function closedWorldLiveFidelity(
  graph: Grounding.GroundGraph,
  system: Root.ManifoldView,
  nodeToPrecept: Int32Array,
  model?: Map<number, Set<number>>
): number {
  const p = readPlacement(graph, system, nodeToPrecept);
  return closedWorldFidelity(graph, p, model).fidelity;
}

/**
 * Standalone behavioural-fidelity probe over the current number line, for a
 * caller that wants to measure without repairing (the bench's held-out metric).
 */
export function arithmeticFidelity(
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  numerals?: Map<number, number>
): number {
  const nums = numerals ?? discoverNumerals(system, atomizer);
  const values = [...nums.keys()].sort((a, b) => a - b);
  const exprs: string[] = [];
  for (const a of values) {
    for (const b of values) {
      exprs.push(`${a} + ${b}`);
      if (a - b >= 0) exprs.push(`${a} - ${b}`);
    }
  }
  return behaviouralFidelity(exprs, system, atomizer).fidelity;
}
