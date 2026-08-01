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
  /**
   * Parse the input as a QUESTION: aux-fronted clauses are rotated into
   * declarative token order before parsing (default false). Off on the
   * ingestion path so a statement can never be rewritten before being
   * asserted - see `parseClause`.
   */
  interrogative?: boolean;
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
  if (inf) return inf;
  // A recovered mis-tagged verb ("chases" read as a plural noun) has no verb
  // parse; its noun singular IS the infinitive ("chases" -> "chase"), and
  // normalizing keeps one node per verb across tagged and recovered uses.
  const sing = nlp(normal).nouns().toSingular().text().trim();
  return sing || normal;
}

/**
 * compromise mis-tags 3rd-person-singular verbs as plural nouns ("the tiger
 * chases the cat" -> chases[Noun,Plural]), which used to make the whole
 * clause parse as a bare NP fragment - the assertion silently landed
 * NOTHING. A non-initial noun directly followed by a determiner in a clause
 * with no real verb is structurally a verb; recover its index, or -1.
 */
function recoverMistaggedVerb(toks: Tok[]): number {
  if (toks.some(isVerbTok)) return -1;
  for (let i = 1; i < toks.length - 1; i++) {
    const t = toks[i];
    if (
      hasTag(t, "Noun") &&
      !hasTag(t, "Pronoun") &&
      hasTag(toks[i + 1], "Determiner")
    ) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Dedup builder (parseRelation writes into the same builder)
// ---------------------------------------------------------------------------

class DedupGraphBuilder extends GraphBuilder {
  private seenEdges = new Map<string, Grounding.GroundEdge>();
  private seenContrasts = new Map<string, Grounding.ContrastPair>();
  /** Attribute rules extracted by tryExtractAttributeRule, deduped. */
  readonly rules: Grounding.GroundRule[] = [];
  private seenRules = new Set<string>();
  /** Pair-exact SVO assertions emitted by parseClause, deduped. Rule content
   *  (hypothetical mode) never records a triple - the structured rule is the
   *  carrier for conditional SVO content. */
  readonly triples: Grounding.GroundTriple[] = [];
  private seenTriples = new Set<string>();

  addRule(rule: Grounding.GroundRule): void {
    const atomKey = (x: Grounding.RuleAtom) =>
      `${x.subject}:${x.verb ?? -1}:${x.predicate}:${x.negated ? 1 : 0}`;
    const key = `${rule.conditions.map(atomKey).sort().join("&")}=>${atomKey(rule.conclusion)}`;
    if (this.seenRules.has(key)) return;
    this.seenRules.add(key);
    this.rules.push(rule);
  }

  triple(
    subject: number,
    verb: number,
    object: number,
    negated: boolean
  ): void {
    if (this.hypothetical) return;
    if (subject < 0 || verb < 0 || object < 0) return;
    const key = `${subject}|${verb}|${object}|${negated ? 1 : 0}`;
    if (this.seenTriples.has(key)) return;
    this.seenTriples.add(key);
    this.triples.push({ subject, verb, object, negated });
  }

  /**
   * While true, created edges/contrasts are stamped `hypothetical` (rule
   * content from an if/then sentence - see GroundEdge.hypothetical). Set per
   * sentence by parseGrammatical. An asserted duplicate UPGRADES an earlier
   * hypothetical record (the fact outranks the rule mention), never the
   * reverse.
   */
  hypothetical = false;

  /**
   * Why `pairScoped` is STICKY while `hypothetical` upgrades.
   *
   * The two stamps look alike but are different kinds of claim, and treating
   * them alike was a soundness leak (measured 2026-07-30, the single CWA
   * break RelNeg-D5-254-12 - see data/benchmarks/README.md):
   *
   * - `hypothetical` is about TRUTH PROVENANCE: "this edge came from rule
   *   content, not an assertion". A later asserted occurrence genuinely
   *   outranks it - the fact really is asserted - so clearing it is right.
   * - `pairScoped` is about STRUCTURAL SCOPE: "this edge is one half of a
   *   reified SVO, so chaining THROUGH it bridges unrelated assertions".
   *   No other sentence can make that safe. A second occurrence of the same
   *   (from,to,kind) in a different role does not turn the shared verb node
   *   into a legitimate transit point; it just means the pair recurs.
   *
   * Because one graph is built per THEORY (all sentences share `seenEdges`),
   * clearing the stamp let a single unstamped recurrence anywhere in the
   * theory re-open the verb node for the whole ledger - which is exactly how
   * "the cat visits the cow" + "the cow is kind" came to affirm "the cat is
   * kind" via `cat -> visit -> cow -> kind`.
   */
  override edge(
    from: number,
    to: number,
    kind: EdgeKind,
    weight = 1,
    pairScoped = false
  ): void {
    if (from < 0 || to < 0 || from === to) return;
    const key = `${from}|${to}|${kind}`;
    const seen = this.seenEdges.get(key);
    if (seen) {
      if (!this.hypothetical) delete seen.hypothetical;
      // A sentence that actually asserts the subsumption ("the bald eagle is
      // an eagle") outranks the one derived from the label, exactly as an
      // asserted duplicate outranks a hypothetical one.
      if (!this.definitional) delete seen.definitional;
      if (pairScoped) seen.pairScoped = true;
      return;
    }
    super.edge(from, to, kind, weight);
    const created = this.edges[this.edges.length - 1];
    if (this.hypothetical) created.hypothetical = true;
    if (pairScoped) created.pairScoped = true;
    this.seenEdges.set(key, created);
  }

  override contrast(a: number, b: number, pairScoped = false): void {
    if (a < 0 || b < 0 || a === b) return;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const seen = this.seenContrasts.get(key);
    if (seen) {
      if (!this.hypothetical) delete seen.hypothetical;
      // Sticky, for the same reason as edges - see the note above.
      if (pairScoped) seen.pairScoped = true;
      return;
    }
    super.contrast(a, b);
    const created = this.contrasts[this.contrasts.length - 1];
    if (this.hypothetical) created.hypothetical = true;
    if (pairScoped) created.pairScoped = true;
    this.seenContrasts.set(key, created);
  }
}

// ---------------------------------------------------------------------------
// Interrogative word order
// ---------------------------------------------------------------------------
//
// A yes/no question is a declarative with its auxiliary fronted, so the parser
// only has to put the auxiliary back where the statement grammar expects it.
// Doing that HERE, on tagged tokens, rather than on the raw string upstream,
// is what lets questions and statements share one noun-phrase convention:
// after rotation the clause reaches `parseClause` and `collectNpGroups`
// looking exactly like the statement it is asking about.
//
// The string-surgery version this replaced (GraphQuery.questionToProposition,
// 2026-07-31) had to tag the remainder with the auxiliary already stripped,
// which is a worse sentence to tag than the original: "bob rich" reads `rich`
// as a comparative and so tags `bob` an imperative Verb, leaving no subject at
// all, while "is bob rich" tags `bob` Noun,Person correctly. Keeping the
// auxiliary through tagging removed that whole failure class, and with it the
// positional fallback that used to paper over it.

/** Auxiliaries that can front an English yes/no question. */
const FRONTED_AUX = new Set([
  "is",
  "are",
  "was",
  "were",
  "can",
  "could",
  "does",
  "do",
  "did",
  "will",
  "would",
  "should",
  "must",
]);
/** Do-support is pure question marking and carries no content: it is dropped
 *  rather than re-seated ("does the mouse visit the cat" -> "the mouse visit
 *  the cat"; the parser lemmatizes the verb anyway). */
const DO_SUPPORT = new Set(["does", "do", "did"]);
/** Articles, by SURFACE. Deliberately not read off the Determiner tag: the
 *  tagger only labels one reliably in sentence-initial position and guesses at
 *  a name-like run mid-string ("felix an animal" tags `an` a bare Noun,
 *  "felix the animal" tags `the` Noun,ProperNoun,Person). Closed class. */
const ARTICLE_SURFACES = new Set(["the", "a", "an"]);
/** Tokens a subject noun phrase may be built from. */
const NP_BODY_TAGS = ["Adjective", "Noun", "Value", "Acronym"];
/** Tokens that can be a noun phrase's HEAD - what the phrase is about. */
const NP_HEAD_TAGS = ["Noun", "Value", "Acronym"];

/**
 * Index of the leading subject NP's head in `toks`, or -1 when there is none.
 *
 * The noun phrase is the maximal leading run of determiner/adjective/noun, in
 * which a determiner may only OPEN the run - that clause is what separates a
 * subject from a predicate nominal, since in "felix a mammal" the `a` starts a
 * new phrase and the subject must stop before it.
 *
 * The head is the run's RIGHTMOST, because English noun phrases are
 * right-headed - the same property `npHead` (LogicGraph.ts) uses to intern one
 * entity to one precept, here deciding a boundary instead of a label. Taking
 * the FIRST noun instead breaks on real corpus surfaces, because the tagger
 * mis-tags leading attributes: "the round green thing" tags `round` as
 * Noun,Singular, so a first-noun cut would yield "the round".
 *
 * When the run reaches the end there is no predicate left, so the head backs
 * off by one: "are roses organisms" is roses / organisms, not a subject with
 * nothing said about it.
 */
function subjectHeadIndex(toks: Tok[]): number {
  const heads: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (
      ARTICLE_SURFACES.has(t.normal) ||
      hasTag(t, "Determiner") ||
      hasTag(t, "Possessive")
    ) {
      if (i > 0) break;
      continue;
    }
    if (!NP_BODY_TAGS.some(tag => hasTag(t, tag))) break;
    if (NP_HEAD_TAGS.some(tag => hasTag(t, tag))) heads.push(i);
  }
  // Positional fallback. An aux-fronted clause has a subject by construction,
  // and it is the constituent right after the auxiliary - so when the tags
  // deny there is a noun phrase there at all, position is the better witness.
  // Measured, not hypothetical: "can fish swim" tags `fish` Verb,PresentTense
  // (the interrogative order misleads the tagger), leaving no head; the
  // rotation to "fish can swim" is what recovers the Noun reading, and it
  // cannot happen unless the boundary is found first.
  if (heads.length === 0) heads.push(0);

  const head =
    heads[heads.length - 1] === toks.length - 1
      ? (heads[heads.length - 2] ?? -1)
      : heads[heads.length - 1];
  if (head < 0) return -1;
  // A subject made only of articles is not a noun phrase. Reachable because
  // the tagger guesses at bare fragments: "the red" tags BOTH words Noun.
  return toks.slice(0, head + 1).every(t => ARTICLE_SURFACES.has(t.normal))
    ? -1
    : head;
}

/**
 * Rotates an aux-fronted clause into declarative token order, or returns null
 * when the clause is not aux-fronted (every statement) or cannot be split.
 *
 * Null means the caller leaves the tokens alone, and for a question that means
 * silence - an unsplittable surface must not become a confidently mis-parsed
 * proposition.
 */
function deFrontInterrogative(toks: Tok[]): Tok[] | null {
  if (toks.length < 3 || !FRONTED_AUX.has(toks[0].normal)) return null;
  const aux = toks[0];
  const rest = toks.slice(1);

  // A content verb later in the clause IS the subject/predicate boundary, so
  // most questions need no noun-phrase heuristic at all: only the copula case,
  // where the fronted auxiliary is itself the verb, has to find where the
  // subject ends.
  const verbIdx = rest.findIndex(isVerbTok);
  let rotated: Tok[];
  if (verbIdx > 0) {
    rotated = DO_SUPPORT.has(aux.normal)
      ? rest
      : [...rest.slice(0, verbIdx), aux, ...rest.slice(verbIdx)];
  } else {
    const head = subjectHeadIndex(rest);
    if (head < 0) return null;
    rotated = [...rest.slice(0, head + 1), aux, ...rest.slice(head + 1)];
  }
  return retag(rotated);
}

/**
 * Re-tags a rotated clause, because compromise is ORDER-SENSITIVE and the tags
 * carried over from interrogative order are stale.
 *
 * This is not incidental tidying - it is measurable, and it runs in both
 * directions (2026-07-31):
 *
 *   "can fish swim"  tags `fish` Verb   | "fish can swim"  tags it Noun
 *   "can felix fly"  tags `fly`  Noun   | "felix can fly"  tags it Verb
 *
 * The tagger is trained on declarative English, so a rotated clause is a
 * BETTER sentence to tag than the question it came from, which in turn is
 * better than the aux-stripped remainder the previous string-surgery version
 * had to work with. Rotating without re-tagging would have parsed "can fish
 * swim" with `fish` as its verb - a silently wrong graph behind a correct-
 * looking surface.
 *
 * The boundary is still found on the QUESTION's tags, where the auxiliary is
 * present to anchor the parse; only the parse that follows uses the fresh
 * ones. Falls back to the rotated tokens if re-tokenizing does not yield
 * exactly one sentence.
 */
function retag(rotated: Tok[]): Tok[] {
  const fresh = tokenize(renderToks(rotated));
  return fresh.length === 1 && fresh[0].length > 0 ? fresh[0] : rotated;
}

/** Renders tokens back to a surface (empty normals are tagger artefacts). */
function renderToks(toks: Tok[]): string {
  return toks
    .map(t => t.normal)
    .filter(Boolean)
    .join(" ");
}

/**
 * The declarative rendering of a question surface - the ANSWER surface, and
 * the only thing the query path still needs a string for.
 *
 * Returns the input unchanged when it is already declarative, and null when it
 * is aux-fronted but unsplittable. It rotates with the SAME `deFrontInterrogative`
 * the parser uses, so the surface an answer echoes and the graph that answer
 * was verified against cannot disagree about where the subject ended.
 */
export function declarativeSurface(text: string): string | null {
  const s = text.trim().replace(/[.!?]+$/, "");
  if (!s) return null;
  const sentences = tokenize(s);
  // Multi-sentence input is not a single question; hand it back untouched.
  if (sentences.length !== 1 || sentences[0].length === 0) return s;
  const toks = sentences[0];
  if (!FRONTED_AUX.has(toks[0].normal)) return s;
  const rotated = deFrontInterrogative(toks);
  return rotated ? renderToks(rotated) : null;
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
 * Interns one NP group and returns its node id, or -1 for an empty span.
 *
 * The span keeps its MODIFIERS ("the bald eagle" -> `bald eagle`), where it
 * used to intern only the last content token (`eagle`). Two parsers feed the
 * same builder and have to agree on one label for one entity; they now agree
 * on the full phrase rather than on the head, so the modifier is not discarded
 * and two birds of the same kind stay two precepts. `GraphBuilder.ensure`
 * relates the phrase to its head by subsumption, so nothing has to be
 * re-derived from the label later.
 *
 * A span with a non-noun head keeps just that token: adjective complements
 * ("felix is red") and Value tokens are not noun phrases, and joining them
 * would invent an entity out of a predicate.
 */
function ensureNp(span: Tok[], b: GraphBuilder): number {
  if (span.length === 0) return -1;
  const head = span[span.length - 1];
  if (span.length === 1 || !hasTag(head, "Noun"))
    return b.ensure(head.normal, NodeKind.Term);
  return b.ensure(span.map(t => t.normal).join(" "), NodeKind.Term);
}

/**
 * Collects coordinated NP heads from a token span: groups are separated by
 * and/or; each group interns as its full content span ("the red cat" ->
 * `red cat`, with `red cat -> cat` added by `ensure`).
 */
function collectNpGroups(
  toks: Tok[],
  b: GraphBuilder,
  afterVerb: boolean
): NpGroup {
  const heads: number[] = [];
  let disjunctive = false;
  let span: Tok[] = [];
  const flush = (): void => {
    const id = ensureNp(span, b);
    if (id >= 0) heads.push(id);
    span = [];
  };
  for (const t of toks) {
    if (t.normal === "and" || t.normal === "or" || hasTag(t, "Conjunction")) {
      if (t.normal === "or") disjunctive = true;
      flush();
      continue;
    }
    if (isContent(t, afterVerb)) span.push(t);
  }
  flush();
  return { heads, disjunctive };
}

/**
 * Parses one clause's argument structure into edges/contrasts and returns the
 * clause head (the node other clauses link to), or -1 for an empty clause.
 */
function parseClause(
  rawToks: Tok[],
  b: DedupGraphBuilder,
  kind: EdgeKind,
  interrogative = false
): number {
  // Interrogative word order is undone HERE so everything below - verb
  // location, NP chunking, negation, reification - runs on one token order.
  // Gated rather than unconditional: `buildGraphFromText` is the INGESTION
  // path too, and a statement that happened to open with an auxiliary would
  // otherwise be silently rewritten before being asserted. No corpus sentence
  // does (0 of 2291 benchmark theory sentences), but the failure would be
  // silent knowledge corruption, and "asking never creates" is a standing
  // invariant of the query path - so the caller states which one it is.
  const toks = (interrogative && deFrontInterrogative(rawToks)) || rawToks;
  const negated = toks.some(t => hasTag(t, "Negative"));

  // Main verb: first non-modal/aux Verb. A copula followed by a tensed verb
  // ("is running") promotes to the tensed verb; a tense-less Verb-mistag
  // ("are not fish") does not. A verbless clause tries mis-tag recovery
  // ("chases" tagged Noun,Plural) before degrading to a bare NP fragment.
  let verbIdx = toks.findIndex(isVerbTok);
  if (verbIdx < 0) verbIdx = recoverMistaggedVerb(toks);
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
      // subject -> verb is assertional (capability: "fish can swim"); the
      // verb's OUTGOING side below is pair-scoped, so nothing chains through.
      // Under transitive negation the subject->verb edge is pair-scoped as
      // well: "the dog does not need the dog" asserts NO dog->need link
      // (measured 2026-07-21: the assertional edge made the negated question
      // itself ledger-affirmable, a confident falsehood on RuleTaker d3).
      if (negated && object.heads.length === 0) b.contrast(s, verbNode);
      else b.edge(s, verbNode, kind, weight, negated);
    }
    for (const o of object.heads) {
      // Pair-scoped: the shared verb node must not bridge different
      // assertions (see GroundEdge.pairScoped).
      if (negated) b.contrast(subject.heads[0] ?? verbNode, o, true);
      else b.edge(verbNode, o, kind, weight, true);
      // Pair-exact triple record: here subject/verb/object are unambiguous,
      // so the assertion is recorded in a form safe to affirm/deny exactly
      // (the sound complement to the pairScoped exclusion).
      for (const s of subject.heads) b.triple(s, verbNode, o, negated);
    }
    clauseHead = verbNode;
  }

  // Prepositional attachment: predicate/complement -> each prep content token
  // ("water boils at 100 degrees" -> boil->100, boil->degree). Verb-anchored
  // attachments share the reified verb node, so they are pair-scoped too.
  const prepAnchor = clauseHead;
  if (prepAnchor >= 0) {
    for (const t of prepToks) {
      if (!isContent(t, true)) continue;
      const n = b.ensure(t.normal, NodeKind.Term);
      b.edge(prepAnchor, n, kind, weight, !copula);
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

// ---------------------------------------------------------------------------
// Attribute-rule extraction (PARITY §3.2 - rule-hop discharge source)
// ---------------------------------------------------------------------------
//
// The flattened hypothetical edges lose antecedent/consequent structure, so
// rules are extracted HERE, at parse time, into Grounding.GroundRule records
// that GraphQuery can discharge. Extraction is deliberately narrow: only
// copula-attribute rules ("if something is rough and not blue then it is not
// kind", "all nice, blue things are kind"). Anything else returns null and
// keeps today's behavior (hypothetical flattening = silence) - the
// characteristic failure must remain silence, never a mis-read rule.

/** Subjects that bind the rule's variable. */
const VAR_SUBJECTS = new Set([
  "something",
  "someone",
  "somebody",
  "anything",
  "anyone",
  "it",
  "they",
]);
/** Dummy heads of quantified generics ("all nice, blue THINGS are kind").
 *  Noun-headed generics ("cats are mammals") must NEVER match: they stay
 *  asserted taxonomy edges - d0 fact lookup and the paraphrase families
 *  chain through them. */
const DUMMY_HEADS = new Set(["thing", "things", "people", "person"]);

function isNegTok(t: Tok): boolean {
  return hasTag(t, "Negative") || t.normal === "not" || t.normal === "no";
}

/**
 * Parses a "[not] PRED-NP" span into its negation flag + predicate node, using
 * the SAME NP convention as the fact side (`ensureNp` - "a bald eagle" ->
 * `bald eagle`). Any token that is not negation/determiner glue must be
 * content; prepositions, verbs, and bound-variable words reject the rule.
 *
 * Rules are the THIRD parser feeding this builder, after delegation and the
 * grammatical pass, and it has to agree with them about what an entity is
 * called. When it interned only the head while they kept the phrase, rules
 * about "the bald eagle" discharged onto a precept no assertion used, and six
 * relational items went silent - "if someone is rough then they need the bald
 * eagle" could not connect to "the rabbit is rough" (measured 2026-07-31).
 */
function parsePredicateSpan(
  span: Tok[],
  b: DedupGraphBuilder
): { predicate: number; negated: boolean } | null {
  let negated = false;
  const np: Tok[] = [];
  for (const t of span) {
    if (isNegTok(t)) {
      negated = true;
      continue;
    }
    if (!t.normal || hasTag(t, "Determiner")) continue;
    if (VAR_SUBJECTS.has(t.normal)) return null;
    if (!isContent(t, true)) return null;
    np.push(t);
  }
  if (np.length === 0) return null;
  return { predicate: ensureNp(np, b), negated };
}

/**
 * Parses a rule-chunk subject span (an NP under the same convention as the
 * fact side, or a bound-variable word): ground node id, -1 for the variable,
 * `inherited` when elided, or null when the span contains anything else.
 */
function parseRuleSubject(
  span: Tok[],
  b: DedupGraphBuilder,
  inherited: number | null
): number | null {
  let sawVar = false;
  const np: Tok[] = [];
  for (const t of span) {
    if (
      !t.normal ||
      hasTag(t, "Determiner") ||
      hasTag(t, "Auxiliary") ||
      isNegTok(t)
    ) {
      continue;
    }
    if (VAR_SUBJECTS.has(t.normal)) {
      sawVar = true;
      continue;
    }
    if (isContent(t, false)) {
      np.push(t);
      continue;
    }
    return null;
  }
  if (np.length > 0) return ensureNp(np, b);
  if (sawVar) return -1;
  return inherited;
}

/**
 * Parses one condition/conclusion chunk into a RuleAtom:
 *   copula:     "[subj] (is|are) [not] PRED"   -> attribute atom
 *   relational: "[subj] [does not] VERB OBJ"   -> SVO atom (verb set)
 *   elided:     "[not] PRED"                    -> inherits subject
 * Subject -1 is the rule's bound variable. Prepositions reject.
 */
function parseRuleChunk(
  chunk: Tok[],
  b: DedupGraphBuilder,
  inheritedSubject: number | null
): Grounding.RuleAtom | null {
  if (chunk.some(t => hasTag(t, "Preposition"))) return null;
  const copIdx = chunk.findIndex(t => hasTag(t, "Copula"));
  let verbIdx = chunk.findIndex(
    t => isVerbTok(t) && !hasTag(t, "Copula") && hasTense(t)
  );
  if (verbIdx < 0 && copIdx < 0) verbIdx = recoverMistaggedVerb(chunk);

  if (verbIdx >= 0 && (copIdx < 0 || verbIdx < copIdx)) {
    // Relational chunk. Negation is do-support before the verb ("does not
    // chase the cat"), so it is read off the whole chunk.
    const subject = parseRuleSubject(
      chunk.slice(0, verbIdx),
      b,
      inheritedSubject
    );
    if (subject === null) return null;
    const obj = parsePredicateSpan(chunk.slice(verbIdx + 1), b);
    if (!obj) return null;
    return {
      subject,
      predicate: obj.predicate,
      verb: b.ensure(verbLemma(chunk[verbIdx].normal), NodeKind.Term),
      negated: chunk.some(isNegTok) || obj.negated,
    };
  }

  let subject: number | null;
  let rest: Tok[];
  if (copIdx < 0) {
    subject = inheritedSubject;
    rest = chunk;
  } else {
    subject = parseRuleSubject(chunk.slice(0, copIdx), b, inheritedSubject);
    rest = chunk.slice(copIdx + 1);
  }
  if (subject === null) return null;
  const p = parsePredicateSpan(rest, b);
  if (!p) return null;
  return { subject, predicate: p.predicate, negated: p.negated };
}

/** Detector A: "if COND (and COND)* then CONCL" rules - copula-attribute
 *  and relational (SVO) chunks both parse; prepositions reject per chunk. */
function tryExtractConditional(
  toks: Tok[],
  b: DedupGraphBuilder
): Grounding.GroundRule | null {
  const ifIdx = toks.findIndex(t => t.normal === "if");
  const thenIdx = toks.findIndex(t => t.normal === "then");
  if (ifIdx < 0 || thenIdx <= ifIdx) return null;
  const anteToks = toks.slice(ifIdx + 1, thenIdx);
  const consToks = toks.slice(thenIdx + 1);
  if (anteToks.length === 0 || consToks.length === 0) return null;

  const chunks: Tok[][] = [];
  let cur: Tok[] = [];
  for (const t of anteToks) {
    if (t.normal === "and") {
      if (cur.length) chunks.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length) chunks.push(cur);
  if (chunks.length === 0 || chunks.length > 4) return null;

  let sawVariable = false;
  let lastSubject: number | null = null;
  const conditions: Grounding.RuleAtom[] = [];
  for (const chunk of chunks) {
    const atom = parseRuleChunk(chunk, b, lastSubject);
    if (!atom) return null;
    lastSubject = atom.subject;
    if (atom.subject === -1) sawVariable = true;
    conditions.push(atom);
  }
  const conclusion = parseRuleChunk(consToks, b, lastSubject);
  if (!conclusion) return null;
  // An unbound consequent variable has nothing to range over.
  if (conclusion.subject === -1 && !sawVariable) return null;
  return { conditions, conclusion };
}

/** Detector B: "(all|every)? ADJ(, ADJ)*(and ADJ)? things|people (is|are)
 *  [not] PRED" quantified generics over a dummy head. */
function tryExtractGeneric(
  toks: Tok[],
  b: DedupGraphBuilder
): Grounding.GroundRule | null {
  const ts = toks.filter(t => t.normal || hasTag(t, "Negative"));
  if (ts.some(t => t.normal === "if" || t.normal === "then")) return null;
  let i = 0;
  if (i < ts.length && (ts[i].normal === "all" || ts[i].normal === "every"))
    i++;
  const condToks: Tok[] = [];
  let headIdx = -1;
  for (; i < ts.length; i++) {
    const t = ts[i];
    if (DUMMY_HEADS.has(t.normal)) {
      headIdx = i;
      break;
    }
    if (t.normal === "and") continue;
    // Negated subject conditions and any non-content glue are out of scope.
    if (isNegTok(t) || hasTag(t, "Copula") || !isContent(t, false)) return null;
    condToks.push(t);
  }
  if (headIdx < 0 || condToks.length === 0 || condToks.length > 4) return null;
  const rest = ts.slice(headIdx + 1);
  if (rest.length === 0 || !hasTag(rest[0], "Copula")) return null;
  const p = parsePredicateSpan(rest.slice(1), b);
  if (!p) return null;
  return {
    conditions: condToks.map(t => ({
      subject: -1,
      predicate: b.ensure(t.normal, NodeKind.Term),
      negated: false,
    })),
    conclusion: { subject: -1, predicate: p.predicate, negated: p.negated },
  };
}

/**
 * Extracts a copula-attribute rule from one sentence's tokens, or returns
 * false when the sentence is not one (the caller then runs the existing
 * parse - silence-preserving fallback). On success the rule is recorded on
 * the builder and the sentence is CONSUMED: its content is conditional, so
 * neither delegation nor the grammatical pass may assert it. The rule's
 * atoms still land hypothetical-stamped Reference edges for terrain shaping
 * and mirrored-ledger membership (query-time node resolution walks that).
 */
function tryExtractAttributeRule(toks: Tok[], b: DedupGraphBuilder): boolean {
  const rule = tryExtractConditional(toks, b) ?? tryExtractGeneric(toks, b);
  if (!rule) return false;
  b.addRule(rule);
  const prevHypothetical = b.hypothetical;
  b.hypothetical = true;
  const memberEdges = (a: Grounding.RuleAtom): void => {
    if (a.verb !== undefined) b.edge(a.verb, a.predicate, EdgeKind.Reference);
    if (a.subject >= 0)
      b.edge(a.subject, a.verb ?? a.predicate, EdgeKind.Reference);
  };
  for (const c of rule.conditions) {
    b.edge(c.predicate, rule.conclusion.predicate, EdgeKind.Reference);
    memberEdges(c);
  }
  memberEdges(rule.conclusion);
  b.hypothetical = prevHypothetical;
  return true;
}

/** Grammatical pass over pre-tokenized sentences. */
function parseGrammatical(
  b: DedupGraphBuilder,
  sentences: Tok[][],
  kind: EdgeKind,
  interrogative = false
): void {
  for (const toks of sentences) {
    const clauses = splitClauses(toks);
    // Conditional sentences ("if ... then ...") are RULES: neither clause is
    // asserted, so everything they intern is stamped hypothetical for the
    // query ledger. "so"/"because" sentences assert both clauses and stay
    // factual ("steam rises because water boils" asserts the rising AND the
    // boiling).
    const prevHypothetical = b.hypothetical;
    b.hypothetical =
      prevHypothetical ||
      toks.some(t => t.normal === "if") ||
      clauses.some(c => c.pivot === "then");
    let prevHead = -1;
    for (const clause of clauses) {
      const head = parseClause(
        stripLeadingPivot(clause.toks),
        b,
        kind,
        interrogative
      );
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
    b.hypothetical = prevHypothetical;
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
  const interrogative = opts.interrogative ?? false;
  const b = new DedupGraphBuilder();

  const lines = Array.isArray(text) ? text : [text];
  const ingest = (statement: string, kind: EdgeKind): void => {
    // Terminal punctuation would otherwise leak into delegation's interned
    // labels ("Anne is not green." -> contrast on "green.").
    const s = statement.trim().replace(/[.!?]+$/, "");
    if (!s) return;
    const sentences = tokenize(s);

    // Attribute-rule sentences are consumed whole by the extractor: their
    // content is conditional, so neither delegation nor the grammatical pass
    // may assert it (quantified generics used to land inert asserted edges
    // on a dummy-head label - "all nice, blue things are kind" interned
    // "blue thing"->kind and silently dropped "nice").
    const remaining: Tok[][] = [];
    for (const toks of sentences) {
      if (!tryExtractAttributeRule(toks, b)) remaining.push(toks);
    }
    if (remaining.length === 0) return;

    // Delegation is gated to single-clause statements: LogicGraph's regexes
    // match across clause boundaries ("if it rains then the ground is wet"
    // would intern subject "it the ground"), so multi-clause surface goes to
    // the grammatical pass alone. The sweep corpora are single-clause
    // symbolic statements, so subsumption is unaffected by the gate.
    // Interrogatives never delegate: LogicGraph's regexes are declarative-order
    // by construction, so an aux-fronted surface either declines (no inner
    // copula to anchor "<x> is <y>") or matches across the fronted auxiliary
    // and interns nonsense. Rotation happens in token space, downstream of
    // here, so there is nothing for the symbolic grammar to see.
    const singleClause =
      sentences.length === 1 && splitClauses(sentences[0]).length === 1;
    const delegated =
      delegate && !interrogative && singleClause && parseRelation(b, s, kind);

    // When delegation cleanly matched, the grammatical pass runs only for
    // NP-coordination distribution ("a and b are c" -> a->c, b->c); running
    // it unconditionally would add noisy reified nodes ("p implies q" ->
    // "imply") on statements the symbolic grammar already covered.
    const hasCoordination = remaining.some(toks =>
      toks.some(t => t.normal === "and" || t.normal === "or")
    );
    if (!delegated || hasCoordination) {
      parseGrammatical(b, remaining, kind, interrogative);
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

  return {
    nodes: b.nodes,
    edges: b.edges,
    contrasts: b.contrasts,
    rules: b.rules,
    triples: b.triples,
  };
}
