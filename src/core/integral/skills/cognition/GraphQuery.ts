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
  // Split the leading subject NP off the remainder, then re-seat the
  // auxiliary after it: "is felix a mammal" -> "felix is a mammal";
  // "can felix fly" -> "felix can fly". For do-support the auxiliary is
  // dropped entirely: "does felix like water" -> "felix like water" (the
  // grammar parser lemmatizes the verb anyway).
  const np = rest.match(
    /^((?:(?:the|a|an|this|that|these|those|my|your|his|her|its|our|their)\s+)?\w+(?:\s+\w+)*?)\s+(.+)$/
  );
  if (!np) return null;
  const [, subject, predicate] = np;
  if (auxWord === "does" || auxWord === "do" || auxWord === "did")
    return `${subject} ${predicate}`;
  return `${subject} ${auxWord} ${predicate}`;
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
// Rule discharge (PARITY §3.2) - transient per-subject closure
// ---------------------------------------------------------------------------

interface DerivedFacts {
  pos: Set<number>;
  neg: Set<number>;
  /** A fired conclusion contradicted asserted or derived knowledge; the
   *  whole closure is poisoned (sets are emptied) and contributes nothing. */
  conflicted: boolean;
}

const EMPTY_DERIVED: DerivedFacts = {
  pos: new Set(),
  neg: new Set(),
  conflicted: false,
};

/**
 * Fires system.textGroundedRules to fixpoint for subject entity `a`,
 * READ-ONLY: derived facts exist only in the returned sets, nothing is
 * written to any ledger and no precept is allocated (asking never creates).
 *
 * Open-world semantics: a positive condition holds via derived facts or
 * directed-ledger reachability (taxonomy chains satisfy conditions); a
 * negated condition holds ONLY via explicit contrast support (derived
 * negative, or a registered contrast partner of the predicate that is the
 * subject itself or asserted-reachable from it). Absence of evidence never
 * fires a rule - the closed-world reading is a separate, future mode.
 *
 * Conflict poisons: if a fired conclusion contradicts asserted or derived
 * knowledge, the closure returns empty - the theory is inconsistent at this
 * subject and silence is the only sound verdict.
 */
function deriveForSubject(system: Root.ManifoldView, a: number): DerivedFacts {
  const rules = system.textGroundedRules;
  if (
    !DOPAT_CONFIG.PHYSICS.TEXT_GRAPH_RULE_DISCHARGE_ENABLED ||
    rules.length === 0
  ) {
    return EMPTY_DERIVED;
  }
  const out: DerivedFacts = {
    pos: new Set(),
    neg: new Set(),
    conflicted: false,
  };

  const holdsPos = (s: number, p: number): boolean =>
    (s === a && out.pos.has(p)) ||
    ledgerReach(system.textGroundedEdgesOut, s, p) >= 0;

  const holdsNeg = (s: number, p: number): boolean => {
    if (s === a && out.neg.has(p)) return true;
    for (const partner of system.textGroundedContrasts.get(p) ?? []) {
      if (
        partner === s ||
        ledgerReach(system.textGroundedEdgesOut, s, partner) >= 0
      ) {
        return true;
      }
    }
    return false;
  };

  for (let iter = 0; iter < MAX_RULE_ITERATIONS; iter++) {
    let changed = false;
    for (const r of rules) {
      const conclSubj = r.conclusion.subject < 0 ? a : r.conclusion.subject;
      if (conclSubj !== a) continue;
      const target = r.conclusion.predicate;
      const bucket = r.conclusion.negated ? out.neg : out.pos;
      if (bucket.has(target)) continue;
      let fire = true;
      for (const c of r.conditions) {
        const s = c.subject < 0 ? a : c.subject;
        if (c.negated ? !holdsNeg(s, c.predicate) : !holdsPos(s, c.predicate)) {
          fire = false;
          break;
        }
      }
      if (!fire) continue;
      // The would-be conclusion contradicting current knowledge (asserted
      // or derived) poisons the closure - an inconsistent theory must not
      // pick a side.
      const contradicted = r.conclusion.negated
        ? holdsPos(a, target)
        : holdsNeg(a, target);
      if (contradicted) {
        out.pos.clear();
        out.neg.clear();
        out.conflicted = true;
        return out;
      }
      bucket.add(target);
      changed = true;
    }
    if (!changed) break;
  }
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

    // Polarity-loss guard: a negated surface whose parse carries NO contrast
    // has dropped its negation (e.g. reflexive "the dog does not need the
    // dog" - the dog><dog self-contrast is discarded, leaving a bare
    // dog->need link). Verifying the residue would answer the POSITIVE
    // reading while echoing the negated surface - a confident falsehood
    // (measured on RuleTaker d3, 2026-07-21). Silence instead.
    if (
      /\b(?:not|never|cannot|no)\b/.test(proposition) &&
      contrasts.length === 0
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
            system.textGroundedContrasts.has(id))
        ) {
          nodePrecept[i] = id;
          break;
        }
      }
    }

    // Rule-discharge closures, one per subject precept, computed lazily and
    // memoized for the duration of this query only.
    const derivedCache = new Map<number, DerivedFacts>();
    const derived = (a: number): DerivedFacts => {
      let d = derivedCache.get(a);
      if (!d) {
        d = deriveForSubject(system, a);
        derivedCache.set(a, d);
      }
      return d;
    };
    let usedDerived = false;

    /** Truth of the positive link a--b: 1 affirm, -1 deny, 0 undecided.
     *  Affirm and deny evidence are computed symmetrically; both present
     *  (a contradictory theory) -> undecided -> silence. */
    const verify = (aNode: number, bNode: number): number => {
      const a = nodePrecept[aNode];
      if (a < 0) return 0;
      const b = nodePrecept[bNode];
      const d = derived(a);
      // A poisoned closure means the theory is inconsistent AT THIS SUBJECT
      // (a fired rule contradicted asserted or derived knowledge). Nothing
      // about the subject is trustworthy - not even its asserted edges, one
      // of which is a party to the contradiction - so the only sound verdict
      // is silence.
      if (d.conflicted) return 0;
      const assertedAffirm =
        b >= 0 && ledgerReach(system.textGroundedEdgesOut, a, b) >= 0;
      const derivedAffirm = b >= 0 && d.pos.has(b);
      const derivedDeny = b >= 0 && d.neg.has(b);
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
      return 0;
    };

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
