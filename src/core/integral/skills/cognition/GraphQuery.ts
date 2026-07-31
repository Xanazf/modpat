/**
 * GraphQuery - the READ side of grammar-grounded ingestion (PARITY §3.1).
 *
 * TextGrounding lands assertions as relational geometry AND an explicit
 * adjacency ledger (system.textGroundedEdges / textGroundedContrasts); this
 * module answers yes/no questions by walking that LEDGER, not the geometry.
 * The question surface is canonicalized to a declarative proposition
 * (closed-class interrogative scaffolds only - no open-class pattern
 * lexicon), parsed with the SAME grammar as ingestion (buildGraphFromText),
 * and verified against the ledger:
 *
 *   AFFIRM - every asked edge is bridged by a ledger chain (BFS, bounded
 *            hop count).
 *   DENY   - the asked object is unreachable but a precept registered as its
 *            CONTRAST partner (the WaveResolver negation pair, recorded
 *            explicitly at grounding time - not re-derived from geometry) is
 *            reachable.
 *   silence - anything else returns null and the caller falls through to the
 *            existing perception path unchanged. The resolver is purely
 *            additive and abstention-preserving: it can only ever add
 *            ledger-decisive answers, never remove an abstention route.
 *
 * Why the ledger and not distance: a fresh assertion sharing no label with
 * anything already grounded (e.g. "rex is a dog" after "cats are mammals")
 * gets an independent SMACOF layout with nothing to anchor it to the rest of
 * the manifold, so it can land arbitrarily close to - or coincident with -an
 * unrelated cluster in absolute space. Distance-based chain search over that
 * geometry is unreliable across separate ingestion calls; the ledger only
 * ever records what a grounding call actually asserted, so it has no such
 * failure mode regardless of how the SMACOF layouts happen to overlap.
 *
 * Direction: chains walk textGroundedEdgesOut (asserted from -> to only), so
 * a reversed taxonomy question ("are animals cats?") falls silent instead of
 * affirming - the v1 undirected ledger's one confident-falsehood mode, now
 * guarded in text_graph.test.ts. Richer directional semantics (converse
 * relations, symmetric predicates) still belong to the signed-Δw propagation
 * work, not here; this only stops the ledger from inventing the mirror.
 */

import { DOPAT_CONFIG } from "@config";
import { buildGraphFromText } from "@core_s/grounding/TextGraph";
import logger from "@utils/SpectralLogger";
import nlp from "compromise";

/** Chain hop budget: taxonomy depth 3 + slack. */
const MAX_HOPS = 8;
/** Rule-discharge fixpoint budget: benchmark theories chain to depth 5. */
const MAX_RULE_ITERATIONS = 16;

export interface GraphQueryResult {
  answer: string;
  confidence: number;
  /** "rule-discharge" when the deciding evidence came from a fired rule. */
  provenance?: "ledger" | "rule-discharge";
}

// ---------------------------------------------------------------------------
// Question canonicalization (closed-class scaffolds only)
// ---------------------------------------------------------------------------

// Runtime.ts's LANGUAGE skill handler passes ctx.query, which is always
// Language.ingest()'s "shifted" perspective form (shiftPerspective turns
// every "you" into "i" unconditionally) - so scaffolds must match BOTH the
// raw second-person surface (direct/test callers) and its shifted form
// (the live traveler.process() path).
const LEAD_SCAFFOLDS: RegExp[] = [
  /^(?:is|are|was|were) it (?:true|the case) that\s+/,
  /^(?:would (?:you|i) say|do (?:you|i) think|does it follow that)\s+(?:that\s+)?/,
  /^so\s+/,
];
const TAIL_SCAFFOLD = /,?\s*(?:right|correct|yes|no)\s*$/;
const AUX_FRONT =
  /^(is|are|was|were|can|could|does|do|did|will|would|should|must)\s+(.+)$/;

/**
 * Tokens a subject noun phrase may be built from. A Determiner only opens a
 * phrase (see `splitSubjectNp`); Adjective/Noun/Value continue one.
 */
const NP_BODY_TAGS = ["Adjective", "Noun", "Value", "Acronym"];
/** Tokens that can be an NP's HEAD - the noun the phrase is about. */
const NP_HEAD_TAGS = ["Noun", "Value", "Acronym"];
/**
 * Articles, by surface. Closed-class, and deliberately not read off the
 * Determiner tag - see `splitSubjectNp`, where the tagger's mid-string
 * mislabelling is what makes the surface the reliable signal.
 */
const ARTICLE_SURFACES = new Set(["the", "a", "an"]);

/**
 * Splits an aux-fronted question's remainder into [subject NP, predicate].
 *
 * The subject boundary cannot be found by counting words. The previous
 * implementation took the SHORTEST leading NP (a lazy `(?:\s+\w+)*?` quantifier),
 * which is right for "felix a mammal" -> `felix` / `a mammal` but wrong for
 * every multi-word subject: "the bald eagle red" split as `the bald` / `eagle
 * red`, canonicalizing "is the bald eagle red?" to "the bald is eagle red"
 * (measured 2026-07-30). Making the quantifier greedy just inverts the failure.
 *
 * So use the tags instead - compromise is already the tagger BOTH graph parsers
 * trust, so the question path now reads word classes the same way the statement
 * path does. Two rules:
 *
 *   1. The NP is the maximal leading run of determiner/adjective/noun, where a
 *      determiner may only OPEN the run. That second clause is what separates
 *      subject from predicate nominal: in "felix a mammal" the `a` starts a new
 *      phrase, so the subject stops before it.
 *   2. The subject ends at the run's RIGHTMOST head noun - English NPs are
 *      right-headed. Cutting at the FIRST noun instead fails on real corpus
 *      surfaces, because the tagger mis-tags leading attributes as nouns:
 *      "the round green thing" tags `round` as Noun,Singular, and a
 *      first-noun cut yields `the round` / `green thing kind`. This is the same
 *      right-headedness `npHead` (LogicGraph.ts) relies on to intern one entity
 *      to one precept, now applied to the split rather than the label.
 *
 * When the run consumes the whole remainder there is no predicate left, so the
 * cut falls back to the previous head: "roses organisms" is `roses` /
 * `organisms`, not a five-word subject with nothing said about it. (This also
 * rescues tagger noise - "felix fly" tags `fly` as a ProperNoun surname.)
 *
 * Returns null when no head is found, or when only one head exists and it
 * cannot be both subject and predicate. Null means silence, which is the
 * correct failure here: an unsplittable surface must not become a confidently
 * mis-parsed proposition.
 *
 * Known residual, accepted: a three-noun surface ("are fire trucks vehicles")
 * is genuinely ambiguous under tags alone - `fire trucks` / `vehicles` is right
 * here and would be wrong for a different sentence with identical tags.
 * Resolving it needs the tokens to reach the clause parser un-round-tripped
 * (PARITY: fold aux-fronting into parseClause), not a better regex.
 */
function splitSubjectNp(rest: string): [string, string] | null {
  const terms = (nlp(rest).json({ terms: { tags: true, normal: true } })[0]
    ?.terms ?? []) as { normal?: string; tags?: string[] }[];
  const toks = terms.map(t => ({
    normal: (t.normal ?? "").toLowerCase(),
    tags: t.tags ?? [],
  }));
  if (toks.length < 2) return null;

  const heads: number[] = [];
  let end = 0;
  for (; end < toks.length; end++) {
    const tags = toks[end].tags;
    // Articles are matched by SURFACE, not by tag: the tagger only reliably
    // labels one in sentence-initial position, and mid-string it guesses at a
    // name-like run instead - "felix an animal" tags `an` as a bare Noun, and
    // "felix the animal" tags `the` Noun,ProperNoun,Person. Keying on the tag
    // there let the run swallow the article and split as `felix an` /
    // `animal`, yielding "felix an is animal". They are a closed class of
    // three, which is exactly the kind of lexicon this module does permit.
    const opensPhrase =
      ARTICLE_SURFACES.has(toks[end].normal) ||
      tags.includes("Determiner") ||
      tags.includes("Possessive");
    // A determiner is only admissible as the run's first token; anywhere else
    // it begins the predicate nominal.
    if (opensPhrase) {
      if (end > 0) break;
      continue;
    }
    if (!NP_BODY_TAGS.some(tag => tags.includes(tag))) break;
    if (NP_HEAD_TAGS.some(tag => tags.includes(tag))) heads.push(end);
  }
  // No head at all means the tagger mis-read the subject itself, not that the
  // surface is unsplittable: "bob rich" tags `bob` as an imperative Verb,
  // because `rich` reads as a comparative and pulls the parse into a verb
  // phrase. Fall back on POSITION - in an aux-fronted question the token right
  // after the auxiliary is the subject whatever it got tagged. This reproduces
  // the old regex's behaviour exactly (a one-word subject), which is the right
  // degradation: it only ever fires where the tags are already untrustworthy,
  // and it cannot mis-place a multi-word boundary because it never claims one.
  if (heads.length === 0) heads.push(0);

  // Rightmost head, backing off when it would leave the predicate empty.
  let head = heads[heads.length - 1];
  if (head === toks.length - 1) {
    if (heads.length < 2) return null;
    head = heads[heads.length - 2];
  }

  const subjectToks = toks.slice(0, head + 1);
  // A subject made only of articles is not a noun phrase. This is reachable
  // despite the head test above because the tagger guesses at bare fragments:
  // "the red" tags BOTH words Noun (no Determiner at all), so the back-off
  // above hands `the` back as a head. It grounds to nothing downstream (lemma
  // strips the article, ensure rejects the empty label), so this only makes an
  // already-safe failure explicit rather than incidental.
  if (subjectToks.every(t => ARTICLE_SURFACES.has(t.normal))) return null;

  const subject = subjectToks
    .map(t => t.normal)
    .join(" ")
    .trim();
  const predicate = toks
    .slice(head + 1)
    .map(t => t.normal)
    .join(" ")
    .trim();
  return subject && predicate ? [subject, predicate] : null;
}

/**
 * Converts a yes/no question surface to a declarative proposition, or null
 * when the surface is not a yes/no question this resolver should touch
 * (wh-questions, imperatives, already-statements without inversion are
 * returned as-is when declarative, null when out of scope).
 */
export function questionToProposition(text: string): string | null {
  let q = text
    .trim()
    .toLowerCase()
    .replace(/[?!.]+$/, "")
    .trim();
  if (!q) return null;
  q = q.replace(TAIL_SCAFFOLD, "");
  for (const re of LEAD_SCAFFOLDS) q = q.replace(re, "");
  // "would X count as Y" -> "X is Y"
  q = q.replace(/^would\s+(.+?)\s+count as\s+/, (_m, s: string) => `${s} is `);
  if (/^(what|who|where|when|why|how|which|whose)\b/.test(q)) return null;

  const aux = q.match(AUX_FRONT);
  if (!aux) return q; // already declarative ("felix is a mammal", "the grass grows")

  const [, auxWord, rest] = aux;
  // For do-support the auxiliary is dropped entirely rather than re-seated
  // ("does felix like water" -> "felix like water"; the grammar parser
  // lemmatizes the verb anyway), so the word order is already declarative and
  // the subject boundary never has to be found.
  if (auxWord === "does" || auxWord === "do" || auxWord === "did") return rest;

  // Everything else re-seats the auxiliary after the subject NP, which means
  // finding where that NP ends: "is felix a mammal" -> "felix is a mammal",
  // "can felix fly" -> "felix can fly".
  const np = splitSubjectNp(rest);
  if (!np) return null;
  return `${np[0]} ${auxWord} ${np[1]}`;
}

// ---------------------------------------------------------------------------
// Ledger-chain verification
// ---------------------------------------------------------------------------

/** BFS over an explicit adjacency ledger; returns hop count from `from` to
 *  `to`, or -1 when unreachable within MAX_HOPS. */
function ledgerReach(
  ledger: ReadonlyMap<number, ReadonlySet<number>>,
  from: number,
  to: number
): number {
  if (from === to) return 0;
  const visited = new Set<number>([from]);
  let frontier = [from];
  for (let hop = 1; hop <= MAX_HOPS; hop++) {
    const next: number[] = [];
    for (const cur of frontier) {
      for (const cand of ledger.get(cur) ?? []) {
        if (visited.has(cand)) continue;
        if (cand === to) return hop;
        visited.add(cand);
        next.push(cand);
      }
    }
    if (next.length === 0) return -1;
    frontier = next;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Rule discharge (PARITY §3.2) - transient whole-theory closure
// ---------------------------------------------------------------------------

interface TheoryClosure {
  /** Derived positive/negative attribute facts, per subject precept. */
  pos: Map<number, Set<number>>;
  neg: Map<number, Set<number>>;
  /** Derived positive/negative SVO facts, absolute `${s}|${v}|${o}` keys. */
  tpos: Set<string>;
  tneg: Set<string>;
  /** Subjects whose derivations contradicted asserted or derived knowledge:
   *  every question about them is silence - one of their asserted facts is a
   *  party to the contradiction, so nothing about them is trustworthy. */
  conflicted: Set<number>;
}

const EMPTY_CLOSURE: TheoryClosure = {
  pos: new Map(),
  neg: new Map(),
  tpos: new Set(),
  tneg: new Set(),
  conflicted: new Set(),
};

/**
 * Fires system.textGroundedRules to fixpoint over the WHOLE theory,
 * READ-ONLY: derived facts exist only in the returned closure, nothing is
 * written to any ledger and no precept is allocated (asking never creates).
 *
 * Variable binding: a rule with a variable conclusion fires once per
 * candidate subject (every entity that appears as a directed-ledger source
 * or a triple subject); a rule with a GROUND conclusion fires when ANY
 * candidate binding satisfies the variable conditions (∃x semantics -
 * "if someone chases the cat then the cat is young").
 *
 * Open-world semantics: a positive condition holds via derived facts,
 * directed-ledger reachability (taxonomy chains), or the pair-exact triple
 * ledger; a negated condition holds ONLY via explicit support (derived
 * negative, a registered contrast partner, or a negated triple). Under the
 * flagged CLOSED-WORLD mode (TEXT_GRAPH_CWA_ENABLED) a negated condition is
 * also satisfied by non-derivability of its positive - evaluated in a
 * second phase each iteration so explicitly-supported firings always win
 * (stratification approximation).
 *
 * Conflict poisons PER SUBJECT: a contradicted conclusion marks its subject
 * conflicted; the subject's derived facts are withheld and every question
 * about it answers silence, while unrelated subjects keep discharging.
 */
function deriveClosure(system: Root.ManifoldView): TheoryClosure {
  const rules = system.textGroundedRules;
  if (
    !DOPAT_CONFIG.PHYSICS.TEXT_GRAPH_RULE_DISCHARGE_ENABLED ||
    rules.length === 0
  ) {
    return EMPTY_CLOSURE;
  }
  const out: TheoryClosure = {
    pos: new Map(),
    neg: new Map(),
    tpos: new Set(),
    tneg: new Set(),
    conflicted: new Set(),
  };
  // Negation-as-failure manufactures facts from ABSENCE, so it is doubly
  // valved: the closed-world flag AND parse completeness - an incompletely
  // read theory has unknown absences.
  const cwa =
    DOPAT_CONFIG.PHYSICS.TEXT_GRAPH_CWA_ENABLED &&
    system.textGroundedUnparsed === 0;

  // Candidate subjects: entities the theory says anything about.
  const candidates = new Set<number>();
  for (const k of system.textGroundedEdgesOut.keys()) candidates.add(k);
  for (const k of system.textGroundedContrasts.keys()) candidates.add(k);
  for (const key of system.textGroundedTriples) {
    candidates.add(Number(key.split("|")[0]));
  }
  for (const key of system.textGroundedTriplesNeg) {
    candidates.add(Number(key.split("|")[0]));
  }

  const setOf = (m: Map<number, Set<number>>, s: number): Set<number> => {
    let set = m.get(s);
    if (!set) {
      set = new Set();
      m.set(s, set);
    }
    return set;
  };

  const holdsPos = (s: number, c: Grounding.TextRuleAtom): boolean => {
    if (c.verb !== undefined) {
      const key = `${s}|${c.verb}|${c.predicate}`;
      return out.tpos.has(key) || system.textGroundedTriples.has(key);
    }
    return (
      out.pos.get(s)?.has(c.predicate) ||
      ledgerReach(system.textGroundedEdgesOut, s, c.predicate) >= 0
    );
  };

  const holdsNegExplicit = (s: number, c: Grounding.TextRuleAtom): boolean => {
    if (c.verb !== undefined) {
      const key = `${s}|${c.verb}|${c.predicate}`;
      return out.tneg.has(key) || system.textGroundedTriplesNeg.has(key);
    }
    if (out.neg.get(s)?.has(c.predicate)) return true;
    for (const partner of system.textGroundedContrasts.get(c.predicate) ?? []) {
      if (
        partner === s ||
        ledgerReach(system.textGroundedEdgesOut, s, partner) >= 0
      ) {
        return true;
      }
    }
    return false;
  };

  const condHolds = (
    c: Grounding.TextRuleAtom,
    x: number,
    naf: boolean
  ): boolean => {
    const s = c.subject < 0 ? x : c.subject;
    if (!c.negated) return holdsPos(s, c);
    if (holdsNegExplicit(s, c)) return true;
    // Negation-as-failure: only in the CWA phase, only when the positive is
    // not derivable right now.
    return naf && cwa && !holdsPos(s, c);
  };

  const conclude = (r: Grounding.TextRule, x: number): boolean => {
    const s = r.conclusion.subject < 0 ? x : r.conclusion.subject;
    if (out.conflicted.has(s)) return false;
    const isRel = r.conclusion.verb !== undefined;
    // NOTE: a variable can soundly unify with an entity NAMED elsewhere in
    // the same rule ("if someone sees the cat then they chase the tiger"
    // firing with X=tiger derives the reflexive chase(tiger,tiger)). An
    // earlier version of this code refused such reflexive derivations,
    // reasoning they were manufactured rather than intended - that was
    // WRONG: every reflexive relational question in the RuleTaker sample
    // (data/benchmarks/ruletaker_sample.jsonl - "the cow visits the cow",
    // "the tiger chases the tiger", etc.) has gold=true, confirming the
    // official semantics derives them exactly this way. Do not re-add a
    // reflexivity guard without re-checking the gold labels first.
    const key = isRel
      ? `${s}|${r.conclusion.verb}|${r.conclusion.predicate}`
      : "";
    const bucket = isRel
      ? r.conclusion.negated
        ? out.tneg
        : out.tpos
      : r.conclusion.negated
        ? setOf(out.neg, s)
        : setOf(out.pos, s);
    const member = isRel ? key : r.conclusion.predicate;
    if ((bucket as Set<string | number>).has(member)) return false;
    // A conclusion contradicting current knowledge (asserted or derived)
    // poisons its subject - an inconsistent theory must not pick a side.
    const contra = r.conclusion.negated
      ? holdsPos(s, r.conclusion)
      : holdsNegExplicit(s, r.conclusion);
    if (contra) {
      out.conflicted.add(s);
      out.pos.delete(s);
      out.neg.delete(s);
      return false;
    }
    (bucket as Set<string | number>).add(member);
    return true;
  };

  const firePass = (naf: boolean): boolean => {
    let changed = false;
    for (const r of rules) {
      const hasVar =
        r.conclusion.subject < 0 || r.conditions.some(c => c.subject < 0);
      const bindings = hasVar ? candidates : [NaN];
      for (const x of bindings) {
        if (!r.conditions.every(c => condHolds(c, x, naf))) continue;
        if (conclude(r, x)) changed = true;
      }
    }
    return changed;
  };

  let iter = 0;
  for (; iter < MAX_RULE_ITERATIONS; iter++) {
    if (firePass(false)) continue;
    // Explicit support exhausted; let the CWA phase (a no-op under OWA)
    // attempt negation-as-failure firings, then return to explicit passes.
    if (!firePass(true)) break;
  }
  logger.debug(
    `[GraphQuery] closure: iters=${iter}${iter >= MAX_RULE_ITERATIONS ? " (CAP HIT)" : ""} cwa=${cwa} pos=${[
      ...out.pos,
    ]
      .map(([s, p]) => `${s}:{${[...p]}}`)
      .join(" ")} neg=${[...out.neg]
      .map(([s, p]) => `${s}:{${[...p]}}`)
      .join(
        " "
      )} tpos={${[...out.tpos]}} tneg={${[...out.tneg]}} conflicted={${[
      ...out.conflicted,
    ]}}`
  );
  return out;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves a yes/no question against the text-grounded geometry.
 * Returns null whenever the geometry is not decisive - the caller MUST fall
 * through to its existing perception path in that case.
 */
export function resolveGraphQuery(
  text: string,
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): GraphQueryResult | null {
  try {
    const proposition = questionToProposition(text);
    if (!proposition) return null;

    const graph = buildGraphFromText(proposition);
    if (graph.nodes.length < 2) return null;
    const contrasts = graph.contrasts ?? [];
    if (graph.edges.length === 0 && contrasts.length === 0) return null;
    if (system.textGroundedEdges.size === 0) return null;

    // Polarity-loss guard: a negated surface whose parse carries NO negation
    // record (contrast or negated triple) has dropped its negation.
    // Verifying the residue would answer the POSITIVE reading while echoing
    // the negated surface - a confident falsehood (measured on RuleTaker d3,
    // 2026-07-21). Silence instead. (Reflexive "the dog does not need the
    // dog" used to trip this - its self-contrast is discarded - but the
    // negated TRIPLE now carries the polarity exactly.)
    if (
      /\b(?:not|never|cannot|no)\b/.test(proposition) &&
      contrasts.length === 0 &&
      !graph.triples?.some(t => t.negated)
    )
      return null;

    // Resolve every node label to an allocated precept THAT ACTUALLY
    // APPEARS in the ledger; any miss means the ledger cannot decide (and
    // asking must never create).
    const nodePrecept = new Int32Array(graph.nodes.length).fill(-1);
    for (let i = 0; i < graph.nodes.length; i++) {
      const scope = atomizer.getSymbolScope(graph.nodes[i].label, false);
      if (scope <= 0) continue;
      for (const id of system.getIdsByScope(scope)) {
        if (
          system.isAllocated(id) &&
          (system.textGroundedEdges.has(id) ||
            system.textGroundedContrasts.has(id) ||
            system.textGroundedTripleParticipants.has(id))
        ) {
          nodePrecept[i] = id;
          break;
        }
      }
    }

    // Whole-theory rule-discharge closure, computed lazily once per query.
    let closureCache: TheoryClosure | null = null;
    const theClosure = (): TheoryClosure => {
      closureCache ??= deriveClosure(system);
      return closureCache;
    };
    let usedDerived = false;
    // Closed-world denial ("not derivable => false") is permitted only under
    // the flag AND when every grounding call landed content - an
    // incompletely-read theory falls back to open-world silence.
    const cwaDeny =
      DOPAT_CONFIG.PHYSICS.TEXT_GRAPH_CWA_ENABLED &&
      system.textGroundedUnparsed === 0;

    /** Truth of the positive link a--b: 1 affirm, -1 deny, 0 undecided.
     *  Affirm and deny evidence are computed symmetrically; both present
     *  (a contradictory theory) -> undecided -> silence. */
    const verify = (aNode: number, bNode: number): number => {
      const a = nodePrecept[aNode];
      if (a < 0) return 0;
      const b = nodePrecept[bNode];
      const d = theClosure();
      // A conflicted subject means the theory is inconsistent AT THIS
      // SUBJECT (a fired rule contradicted asserted or derived knowledge).
      // Nothing about it is trustworthy - not even its asserted edges, one
      // of which is a party to the contradiction - so the only sound verdict
      // is silence.
      if (d.conflicted.has(a)) return 0;
      const assertedAffirm =
        b >= 0 && ledgerReach(system.textGroundedEdgesOut, a, b) >= 0;
      const derivedAffirm = b >= 0 && (d.pos.get(a)?.has(b) ?? false);
      const derivedDeny = b >= 0 && (d.neg.get(a)?.has(b) ?? false);
      // Asserted deny: some precept registered as the object's contrast
      // partner is reachable from the subject. The object precept itself may
      // be outside the ledger - scan every allocated precept of its scope
      // for one that IS a registered contrast member.
      let assertedDeny = false;
      const objIds =
        b >= 0
          ? [b]
          : [
              ...system.getIdsByScope(
                atomizer.getSymbolScope(graph.nodes[bNode].label, false)
              ),
            ].filter(id => system.isAllocated(id));
      scan: for (const obj of objIds) {
        for (const partner of system.textGroundedContrasts.get(obj) ?? []) {
          if (ledgerReach(system.textGroundedEdgesOut, a, partner) >= 0) {
            assertedDeny = true;
            break scan;
          }
        }
      }
      const affirm = assertedAffirm || derivedAffirm;
      const deny = assertedDeny || derivedDeny;
      if (affirm && deny) return 0;
      if (affirm) {
        if (!assertedAffirm) usedDerived = true;
        return 1;
      }
      if (deny) {
        if (!assertedDeny) usedDerived = true;
        return -1;
      }
      // Closed-world mode: both entities are resolved in the ledger, the
      // theory is fully parsed, and the positive is not derivable => false.
      //
      // Denial-from-absence is sound only if the closure saw everything the
      // theory knows about this subject. The measured way that failed was
      // ENTITY ALIASING (one entity interned under two labels, its knowledge
      // split across precepts); that is now prevented at the source by
      // head-noun normalisation in GraphBuilder.ensure (LogicGraph.npHead),
      // so a subject resolved here carries the whole record. An
      // alias-detecting guard was tried at this branch first and removed once
      // the normalisation landed: with single-word Term labels it could never
      // fire, and an unreachable safety net is worse than a documented
      // absence. If NP normalisation is ever narrowed, this is the branch
      // that stops being sound - see data/benchmarks/README.md.
      if (cwaDeny && b >= 0) {
        usedDerived = true;
        return -1;
      }
      return 0;
    };

    /** Truth of the positive triple s-v-o: same contract as verify(). */
    const verifyTriple = (t: Grounding.GroundTriple): number => {
      const s = nodePrecept[t.subject];
      const v = nodePrecept[t.verb];
      const o = nodePrecept[t.object];
      if (s < 0 || v < 0 || o < 0) return 0;
      const d = theClosure();
      if (d.conflicted.has(s)) return 0;
      const key = `${s}|${v}|${o}`;
      const assertedAffirm = system.textGroundedTriples.has(key);
      const derivedAffirm = d.tpos.has(key);
      const assertedDeny = system.textGroundedTriplesNeg.has(key);
      const derivedDeny = d.tneg.has(key);
      const affirm = assertedAffirm || derivedAffirm;
      const deny = assertedDeny || derivedDeny;
      if (affirm && deny) return 0;
      if (affirm) {
        if (!assertedAffirm) usedDerived = true;
        return 1;
      }
      if (deny) {
        if (!assertedDeny) usedDerived = true;
        return -1;
      }
      // Same soundness condition as verify()'s CWA branch, same reason it
      // holds: head-noun normalisation keeps one entity on one precept.
      if (cwaDeny) {
        usedDerived = true;
        return -1;
      }
      return 0;
    };

    // Relational (SVO) questions carry pair-exact triples - those decide
    // exactly, and the pair-scoped edges/contrasts the same parse emits are
    // noise for verification, so the triple path takes precedence.
    if (graph.triples?.length) {
      let verdict = 0;
      let negatedQ = false;
      for (const t of graph.triples) {
        const v = verifyTriple(t);
        if (v === 0) return null;
        if (t.negated) negatedQ = true;
        if (verdict === 0) verdict = v;
        else if (verdict !== v) return null;
      }
      const t0 = graph.triples[0];
      const s = graph.nodes[t0.subject].label;
      const vb = graph.nodes[t0.verb].label;
      const o = graph.nodes[t0.object].label;
      const positive = verdict === 1;
      let answer: string;
      if (negatedQ) {
        answer = positive
          ? `the ${s} does ${vb} the ${o}`
          : `correct, the ${s} does not ${vb} the ${o}`;
      } else {
        answer = positive
          ? proposition
          : `no, the ${s} does not ${vb} the ${o}`;
      }
      const provenance = usedDerived ? "rule-discharge" : "ledger";
      logger.debug(
        `[GraphQuery] "${text}" -> "${answer}" (triple verdict ${verdict}, ${provenance})`
      );
      return { answer, confidence: usedDerived ? 0.85 : 0.9, provenance };
    }

    // The asked proposition: negated questions arrive as contrast pairs
    // (the grammar already folded "not" into a contrast), positive ones as
    // edges. Every asked link must agree; any undecided link -> silence.
    let negatedQuestion = false;
    const links: Array<[number, number]> = [];
    for (const e of graph.edges) links.push([e.from, e.to]);
    for (const c of contrasts) {
      links.push([c.a, c.b]);
      negatedQuestion = true;
    }
    if (links.length === 0) return null;

    let verdict = 0;
    for (const [a, b] of links) {
      const v = verify(a, b);
      if (v === 0) return null;
      if (verdict === 0) verdict = v;
      else if (verdict !== v) return null; // conflicting links -> silence
    }

    // Surface the verdict about the POSITIVE proposition, phrased against
    // the question's own polarity so the reply reads naturally.
    const subj = graph.nodes[links[0][0]].label;
    const obj = graph.nodes[links[0][1]].label;
    const positive = verdict === 1;
    let answer: string;
    if (negatedQuestion) {
      answer = positive
        ? `${subj} is ${obj}`
        : `correct, ${subj} is not ${obj}`;
    } else {
      answer = positive ? proposition : `no, ${subj} is not ${obj}`;
    }
    const provenance = usedDerived ? "rule-discharge" : "ledger";
    logger.debug(
      `[GraphQuery] "${text}" -> "${answer}" (verdict ${verdict}, ${provenance})`
    );
    return { answer, confidence: usedDerived ? 0.85 : 0.9, provenance };
  } catch (e) {
    logger.warn("[GraphQuery] resolver failed, falling through:", e);
    return null;
  }
}
