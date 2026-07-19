/**
 * TextGraph - grammar-grounded text -> GroundGraph (PARITY §3.1 route (a)).
 *
 * A grammatical parse IS a typed directed graph over terms: clause structure
 * gives containment/implication, argument structure gives reference edges,
 * negation gives contrast pairs. This module turns natural-language
 * assertions into the same GroundGraph IR that code (AstGrounding) and
 * symbolic logic/math (LogicGraph) already share, so the SAME placement /
 * fidelity / traversal machinery applies to naturalistic English.
 *
 * Parse strategy per statement (delegate-first subsumption):
 *   1. LogicGraph's symbolic grammar runs first (`parseRelation` on the same
 *      `|-` / `&&` split as `buildGraphFromLogic`) - so TextGraph ⊇ LogicGraph
 *      by construction on the symbolic surface.
 *   2. A grammatical pass (compromise term tags, NOT the pattern lexicon)
 *      runs additionally and enriches: content-verb SVO (reified predicate),
 *      multi-clause if/then/so/because linking, NP-coordination distribution,
 *      negation -> contrast, prepositional attachment, numeral normalization
 *      ("one hundred" -> 100 -> NodeKind.Literal, so posW = value holds).
 *   Both passes share one builder; duplicate edges/contrasts are deduped.
 *
 * Pronouns are NOT resolved here - callers pass text through
 * `WorkingMemory.resolveReferences` upstream; bare pronouns yield no node.
 *
 * Pure module: no System or DB dependency (same charter as LogicGraph).
 * Nothing is superseded by this module: LogicGraph stays live as the
 * delegated symbolic grammar; tripleExtract/Unfolder migration is follow-up.
 */

import { EdgeKind, NodeKind } from "@core_s/helpers/enums";
import nlp from "compromise";
import { GraphBuilder, parseRelation } from "./LogicGraph";

export interface TextGraphOptions {
  /** Run LogicGraph's symbolic grammar per statement (default true). */
  delegateLogicGrammar?: boolean;
}

// ---------------------------------------------------------------------------
// Token model
// ---------------------------------------------------------------------------

interface Tok {
  normal: string;
  tags: string[];
}

/** Clause-splitting pivots ("then" carries no tag in compromise v14). */
const CLAUSE_PIVOTS = new Set(["and", "or", "but", "so", "because", "then"]);
/** Quantifier/glue normals that never become nodes. */
const STOP_NORMALS = new Set([
  "all",
  "every",
  "some",
  "each",
  "if",
  "then",
  "so",
  "because",
  "not",
  "no",
  "true",
]);
/** Copula surface forms (tag Copula is present on is/are/was/were). */
const TENSE_TAGS = [
  "PastTense",
  "PresentTense",
  "Gerund",
  "Participle",
  "Infinitive",
  "FutureTense",
];

function hasTag(t: Tok, tag: string): boolean {
  return t.tags.includes(tag);
}

function hasTense(t: Tok): boolean {
  return TENSE_TAGS.some(tag => t.tags.includes(tag));
}

function isVerbTok(t: Tok): boolean {
  return hasTag(t, "Verb") && !hasTag(t, "Modal") && !hasTag(t, "Auxiliary");
}

/**
 * Content tokens become nodes. `afterVerb` admits tense-less Verb-mistags
 * ("cats are not fish" tags "fish" as Verb) as complements.
 */
function isContent(t: Tok, afterVerb: boolean): boolean {
  if (!t.normal || STOP_NORMALS.has(t.normal)) return false;
  if (
    hasTag(t, "Pronoun") ||
    hasTag(t, "Determiner") ||
    hasTag(t, "Preposition") ||
    hasTag(t, "Conjunction") ||
    hasTag(t, "Negative") ||
    hasTag(t, "QuestionWord")
  ) {
    return false;
  }
  if (
    hasTag(t, "Noun") ||
    hasTag(t, "Adjective") ||
    hasTag(t, "Value") ||
    hasTag(t, "Acronym")
  ) {
    return true;
  }
  // Tense-less Verb after the main verb is a mis-tagged nominal complement.
  return afterVerb && hasTag(t, "Verb") && !hasTag(t, "Copula") && !hasTense(t);
}

/** "chased" -> "chase", "rains" -> "rain"; falls back to the raw normal. */
function verbLemma(normal: string): string {
  const inf = nlp(normal).verbs().toInfinitive().text().trim();
  return inf || normal;
}

// ---------------------------------------------------------------------------
// Dedup builder (parseRelation writes into the same builder)
// ---------------------------------------------------------------------------

class DedupGraphBuilder extends GraphBuilder {
  private seenEdges = new Set<string>();
  private seenContrasts = new Set<string>();

  override edge(from: number, to: number, kind: EdgeKind, weight = 1): void {
    if (from < 0 || to < 0 || from === to) return;
    const key = `${from}|${to}|${kind}`;
    if (this.seenEdges.has(key)) return;
    this.seenEdges.add(key);
    super.edge(from, to, kind, weight);
  }

  override contrast(a: number, b: number): void {
    if (a < 0 || b < 0 || a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (this.seenContrasts.has(key)) return;
    this.seenContrasts.add(key);
    super.contrast(a, b);
  }
}

// ---------------------------------------------------------------------------
// Grammatical clause parsing
// ---------------------------------------------------------------------------

interface NpGroup {
  /** Head node ids of coordinated NPs (one per conjunct). */
  heads: number[];
  /** True when the coordination is disjunctive ("or"). */
  disjunctive: boolean;
}

/**
 * Collects coordinated NP heads from a token span: groups are separated by
 * and/or; each group's head is its LAST content token ("the red cat" -> cat).
 */
function collectNpGroups(
  toks: Tok[],
  b: GraphBuilder,
  afterVerb: boolean
): NpGroup {
  const heads: number[] = [];
  let disjunctive = false;
  let current: Tok | null = null;
  for (const t of toks) {
    if (t.normal === "and" || t.normal === "or" || hasTag(t, "Conjunction")) {
      if (t.normal === "or") disjunctive = true;
      if (current) {
        heads.push(b.ensure(current.normal, NodeKind.Term));
        current = null;
      }
      continue;
    }
    if (isContent(t, afterVerb)) current = t;
  }
  if (current) heads.push(b.ensure(current.normal, NodeKind.Term));
  return { heads, disjunctive };
}

/**
 * Parses one clause's argument structure into edges/contrasts and returns the
 * clause head (the node other clauses link to), or -1 for an empty clause.
 */
function parseClause(
  toks: Tok[],
  b: DedupGraphBuilder,
  kind: EdgeKind
): number {
  const negated = toks.some(t => hasTag(t, "Negative"));

  // Main verb: first non-modal/aux Verb. A copula followed by a tensed verb
  // ("is running") promotes to the tensed verb; a tense-less Verb-mistag
  // ("are not fish") does not.
  let verbIdx = toks.findIndex(isVerbTok);
  let copula = verbIdx >= 0 && hasTag(toks[verbIdx], "Copula");
  if (copula) {
    for (let j = verbIdx + 1; j < toks.length; j++) {
      if (isVerbTok(toks[j]) && hasTense(toks[j])) {
        verbIdx = j;
        copula = false;
        break;
      }
      if (isContent(toks[j], true)) break;
    }
  }

  // No verb at all: a bare NP fragment; its head can still anchor clause links.
  if (verbIdx < 0) {
    const np = collectNpGroups(toks, b, false);
    return np.heads[np.heads.length - 1] ?? -1;
  }

  const beforeVerb = toks.slice(0, verbIdx);
  const afterVerbToks = toks.slice(verbIdx + 1);
  // Object span ends at the first preposition; each preposition opens an
  // attachment span.
  const prepIdx = afterVerbToks.findIndex(t => hasTag(t, "Preposition"));
  const objectToks =
    prepIdx < 0 ? afterVerbToks : afterVerbToks.slice(0, prepIdx);
  const prepToks = prepIdx < 0 ? [] : afterVerbToks.slice(prepIdx + 1);

  const subject = collectNpGroups(beforeVerb, b, false);
  const object = collectNpGroups(objectToks, b, true);
  const weight = subject.disjunctive || object.disjunctive ? 0.5 : 1;

  let clauseHead = -1;

  if (copula) {
    // subject -> complement, one edge per coordinated pair.
    for (const s of subject.heads) {
      for (const o of object.heads) {
        if (negated) b.contrast(s, o);
        else b.edge(s, o, kind, weight);
      }
    }
    clauseHead = object.heads[0] ?? subject.heads[0] ?? -1;
  } else {
    // Reified predicate: subject -> verb -> object keeps the verb a
    // first-class, queryable term (LogicGraph never parses content verbs,
    // so this is pure enrichment - no subsumption risk).
    const verbNode = b.ensure(verbLemma(toks[verbIdx].normal), NodeKind.Term);
    for (const s of subject.heads) {
      if (negated && object.heads.length === 0) b.contrast(s, verbNode);
      else b.edge(s, verbNode, kind, weight);
    }
    for (const o of object.heads) {
      if (negated) b.contrast(subject.heads[0] ?? verbNode, o);
      else b.edge(verbNode, o, kind, weight);
    }
    clauseHead = verbNode;
  }

  // Prepositional attachment: predicate/complement -> each prep content token
  // ("water boils at 100 degrees" -> boil->100, boil->degree).
  const prepAnchor = clauseHead;
  if (prepAnchor >= 0) {
    for (const t of prepToks) {
      if (!isContent(t, true)) continue;
      const n = b.ensure(t.normal, NodeKind.Term);
      b.edge(prepAnchor, n, kind, weight);
    }
  }

  return clauseHead;
}

/**
 * Splits a sentence's tokens into clauses at pivots (and/or/but/so/because/
 * then) that have a verb on BOTH sides - NP-coordination ("a and b are c")
 * stays intact. Returns clause spans plus the pivot that preceded each.
 */
function splitClauses(toks: Tok[]): { toks: Tok[]; pivot: string | null }[] {
  const hasVerb = (span: Tok[]) => span.some(t => hasTag(t, "Verb"));
  const out: { toks: Tok[]; pivot: string | null }[] = [];
  let start = 0;
  let pivot: string | null = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const isPivot = CLAUSE_PIVOTS.has(t.normal) || hasTag(t, "Conjunction");
    if (
      isPivot &&
      hasVerb(toks.slice(start, i)) &&
      hasVerb(toks.slice(i + 1))
    ) {
      out.push({ toks: toks.slice(start, i), pivot });
      pivot = t.normal;
      start = i + 1;
    }
  }
  out.push({ toks: toks.slice(start), pivot });
  return out;
}

/** Strips leading subordinators ("if it rains" -> "it rains"). */
function stripLeadingPivot(toks: Tok[]): Tok[] {
  let i = 0;
  while (
    i < toks.length &&
    (CLAUSE_PIVOTS.has(toks[i].normal) ||
      toks[i].normal === "if" ||
      !toks[i].normal)
  ) {
    // Keep zero-text Negative tokens ("cannot" expansion) - drop only glue.
    if (!toks[i].normal && hasTag(toks[i], "Negative")) break;
    i++;
  }
  return toks.slice(i);
}

/** Tokenizes a statement into per-sentence token lists (numerals normalized). */
function tokenize(statement: string): Tok[][] {
  const doc = nlp(statement);
  // "one hundred" -> "100" (single Value token) so numerals intern as
  // NodeKind.Literal with `numeric` set and placement stamps posW = value.
  doc.numbers().toNumber();
  return (doc.json() as { terms: { normal: string; tags?: string[] }[] }[]).map(
    sentence =>
      sentence.terms.map(t => ({
        normal: (t.normal ?? "").toLowerCase(),
        tags: t.tags ?? [],
      }))
  );
}

/** Grammatical pass over pre-tokenized sentences. */
function parseGrammatical(
  b: DedupGraphBuilder,
  sentences: Tok[][],
  kind: EdgeKind
): void {
  for (const toks of sentences) {
    const clauses = splitClauses(toks);
    let prevHead = -1;
    for (const clause of clauses) {
      const head = parseClause(stripLeadingPivot(clause.toks), b, kind);
      if (head >= 0 && prevHead >= 0) {
        // Clause linking: "if A then B" / "A so B" -> A's head references
        // B's head; "B because A" reverses. Plain and/but/or add no link.
        if (clause.pivot === "then" || clause.pivot === "so") {
          b.edge(prevHead, head, EdgeKind.Reference);
        } else if (clause.pivot === "because") {
          b.edge(head, prevHead, EdgeKind.Reference);
        }
      }
      if (head >= 0) prevHead = head;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parses natural-language statements into a GroundGraph. Statements are
 * lines; `&&` conjoins premises and `|-` splits premises from a conclusion,
 * exactly as `buildGraphFromLogic` - the symbolic grammar is delegated to
 * first, then the grammatical pass enriches the same builder.
 */
export function buildGraphFromText(
  text: string | string[],
  opts: TextGraphOptions = {}
): Grounding.GroundGraph {
  const delegate = opts.delegateLogicGrammar ?? true;
  const b = new DedupGraphBuilder();

  const lines = Array.isArray(text) ? text : [text];
  const ingest = (statement: string, kind: EdgeKind): void => {
    // Terminal punctuation would otherwise leak into delegation's interned
    // labels ("Anne is not green." -> contrast on "green.").
    const s = statement.trim().replace(/[.!?]+$/, "");
    if (!s) return;
    const sentences = tokenize(s);

    // Delegation is gated to single-clause statements: LogicGraph's regexes
    // match across clause boundaries ("if it rains then the ground is wet"
    // would intern subject "it the ground"), so multi-clause surface goes to
    // the grammatical pass alone. The sweep corpora are single-clause
    // symbolic statements, so subsumption is unaffected by the gate.
    const singleClause =
      sentences.length === 1 && splitClauses(sentences[0]).length === 1;
    const delegated = delegate && singleClause && parseRelation(b, s, kind);

    // When delegation cleanly matched, the grammatical pass runs only for
    // NP-coordination distribution ("a and b are c" -> a->c, b->c); running
    // it unconditionally would add noisy reified nodes ("p implies q" ->
    // "imply") on statements the symbolic grammar already covered.
    const hasCoordination = sentences.some(toks =>
      toks.some(t => t.normal === "and" || t.normal === "or")
    );
    if (!delegated || hasCoordination) {
      parseGrammatical(b, sentences, kind);
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    const [premiseSide, conclusionSide] = line.split(/\|-/);
    for (const clause of premiseSide.split(/&&/)) {
      ingest(clause, EdgeKind.Reference);
    }
    if (conclusionSide?.trim()) {
      ingest(conclusionSide, EdgeKind.Reduction);
    }
  }

  return { nodes: b.nodes, edges: b.edges, contrasts: b.contrasts };
}
