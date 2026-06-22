/**
 * SceneGraph - the vision half of the unified structural IR (Phase 6, first
 * increment; ROADMAP intermediate step #8).
 *
 * The logic/math sweep proved a second domain lands through the SAME GroundGraph
 * IR with no new grounding machinery (LogicGraph -> groundGraphIntoSystem). A
 * scene is just another typed directed graph over terms; its objects and spatial
 * relations map onto the same three edge kinds, so vision's first increment is
 * exactly this parser - no camera pipeline required - scored by the same
 * mapFidelity / traversalFidelity vs a shuffled null.
 *
 *   | edge kind   | scene                                                     |
 *   | ----------- | --------------------------------------------------------- |
 *   | containment | a container/region holds an object (box -> apple)         |
 *   | reference   | a spatial relation between objects (cup ON table)         |
 *   | reduction   | coreference / identity (the red ball === the ball)        |
 *
 * Adjacency means attraction, so spatially-related objects become metric-near
 * (reference); nesting deepens posZ (containment); two labels for the SAME
 * entity co-locate (reduction - "co-location of equals", exactly as arithmetic
 * eval and modus ponens do for their domains).
 *
 * Grammar (one relation per line; `#` comments; `&&` conjoins clauses):
 *   - containment:  "<c> (contains|holds|has) <o>"      -> CONTAINMENT c->o
 *                   "<o> (in|inside|within) <c>"          -> CONTAINMENT c->o
 *   - spatial ref:  "<a> (on|near|beside|behind|above|below|under|over|atop|
 *                        next to|left of|right of|in front of|close to|
 *                        adjacent to) <b>"                -> REFERENCE a->b
 *   - identity:     "<a> (same as|is the same as|identical to|=) <b>"
 *                                                          -> REDUCTION a->b
 *
 * Pure module: plain data + a builder, no System or DB dependency.
 */

import { EdgeKind, NodeKind } from "@core_s/helpers/enums";
import { parseNumericLabel } from "@core_s/helpers/functions";
import { lemma } from "@skill_cogi/Reduction";

/** Spatial-relation phrases that denote adjacency (REFERENCE). Longest first so
 *  multi-word phrases win the match before their single-word prefixes. */
const SPATIAL_RELATIONS = [
  "in front of",
  "next to",
  "left of",
  "right of",
  "close to",
  "adjacent to",
  "on top of",
  "above",
  "below",
  "under",
  "over",
  "beside",
  "behind",
  "near",
  "atop",
  "on",
];

/** Container-first containment verbs: subject holds the object. */
const HOLDS = ["contains", "holds", "has"];
/** Object-first containment prepositions: subject is held by the object. */
const HELD_BY = ["inside", "within", "in"];
/** Identity / coreference phrases (REDUCTION). */
const IDENTITY = ["is the same as", "same as", "identical to", "="];

const word = (s: string) => s.replace(/[+*?.^$()[\]{}|\\]/g, "\\$&");

/** Builds an alternation regex matching " <a> PHRASE <b> " for a phrase list. */
function relationRegex(phrases: string[]): RegExp {
  const alt = phrases.map(word).join("|");
  return new RegExp(`^(.+?)\\s+(?:${alt})\\s+(.+)$`, "i");
}

const SPATIAL_RE = relationRegex(SPATIAL_RELATIONS);
const HOLDS_RE = relationRegex(HOLDS);
const HELD_BY_RE = relationRegex(HELD_BY);
const IDENTITY_RE = relationRegex(IDENTITY);

class SceneBuilder {
  private idByLabel = new Map<string, number>();
  readonly nodes: Grounding.GroundNode[] = [];
  readonly edges: Grounding.GroundEdge[] = [];

  /** Interns a node by lemmatised label; a later, more specific kind (e.g. a
   *  Term first seen as an object, later used as a container Module) upgrades it. */
  ensure(rawLabel: string, kind: NodeKind): number {
    const numeric = parseNumericLabel(rawLabel);
    const label = numeric !== null ? rawLabel.trim() : lemma(rawLabel);
    if (!label) return -1;
    let id = this.idByLabel.get(label);
    if (id === undefined) {
      id = this.nodes.length;
      this.idByLabel.set(label, id);
      this.nodes.push({
        id,
        label,
        kind: numeric !== null ? NodeKind.Literal : kind,
        numeric,
      });
    } else if (
      kind === NodeKind.Module &&
      this.nodes[id].kind === NodeKind.Term
    ) {
      // A region/container is a more specific role than a bare object.
      this.nodes[id].kind = NodeKind.Module;
    }
    return id;
  }

  edge(from: number, to: number, kind: EdgeKind, weight = 1): void {
    if (from < 0 || to < 0 || from === to) return;
    this.edges.push({ from, to, kind, weight });
  }
}

/** Parses one clause into at most one edge; returns true if it matched. */
function parseClause(b: SceneBuilder, clause: string): boolean {
  const s = clause.trim();
  if (!s) return false;

  // Identity (reduction) first: "<a> same as <b>" - co-location of equals.
  let m = s.match(IDENTITY_RE);
  if (m) {
    const a = b.ensure(m[1], NodeKind.Term);
    const c = b.ensure(m[2], NodeKind.Term);
    b.edge(a, c, EdgeKind.Reduction, 3);
    return true;
  }

  // Containment, container-first: "<c> contains <o>".
  m = s.match(HOLDS_RE);
  if (m) {
    const c = b.ensure(m[1], NodeKind.Module);
    const o = b.ensure(m[2], NodeKind.Term);
    b.edge(c, o, EdgeKind.Containment);
    return true;
  }

  // Containment, object-first: "<o> in <c>" -> container c holds object o.
  m = s.match(HELD_BY_RE);
  if (m) {
    const o = b.ensure(m[1], NodeKind.Term);
    const c = b.ensure(m[2], NodeKind.Module);
    b.edge(c, o, EdgeKind.Containment);
    return true;
  }

  // Spatial relation (reference): "<a> on <b>", "<a> left of <b>", ...
  m = s.match(SPATIAL_RE);
  if (m) {
    const a = b.ensure(m[1], NodeKind.Term);
    const c = b.ensure(m[2], NodeKind.Term);
    b.edge(a, c, EdgeKind.Reference);
    return true;
  }

  return false;
}

/**
 * Parses a scene description into a GroundGraph. Each line is one (or, via `&&`,
 * several) spatial relations; the resulting typed graph feeds the same
 * `groundGraphIntoSystem` placement and the same fidelity metrics as code and
 * logic/math.
 */
export function buildGraphFromScene(
  statements: string[]
): Grounding.GroundGraph {
  const b = new SceneBuilder();
  for (const raw of statements) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    for (const clause of line.split(/&&/)) parseClause(b, clause);
  }
  return { nodes: b.nodes, edges: b.edges };
}
