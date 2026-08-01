/**
 * Rule-discharge guard tests (PARITY §3.2 - rule-hop depth d1+).
 *
 * Two surfaces:
 *   1. Extraction correctness - attribute rules (if/then conditionals and
 *      dummy-head quantified generics) become structured GroundRules with
 *      ALL conjuncts and negation flags intact; everything else keeps
 *      today's parse (noun-headed taxonomy stays asserted, verb rules stay
 *      hypothetical-flattened silence).
 *   2. Discharge soundness - the query-time closure fires a rule only when
 *      EVERY condition holds, negated conditions demand explicit contrast
 *      support (open-world: absence never fires), chains reach d2+,
 *      ground-subject rules fire only for their subject, derived-vs-asserted
 *      conflict is silence, and asking never creates or mutates. The
 *      characteristic failure must remain silence - these guards exist so a
 *      regression can only ever look like lost answers, never like new
 *      confident falsehoods.
 */

import * as assert from "node:assert";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import { buildGraphFromText } from "@core_s/grounding/TextGraph";
import { groundTextIfEnabled } from "@core_s/grounding/TextGrounding";
import Store from "@core_s/Memory";
import { resolveGraphQuery } from "@skill_cogi/GraphQuery";
import { describe, it } from "./utils/harness";

function ruleShapes(g: Grounding.GroundGraph): string[] {
  const lbl = (i: number) => (i < 0 ? "VAR" : g.nodes[i].label);
  const atom = (a: Grounding.RuleAtom) =>
    `${a.negated ? "!" : ""}${lbl(a.subject)}.${
      a.verb !== undefined ? `${lbl(a.verb)}:` : ""
    }${lbl(a.predicate)}`;
  return (g.rules ?? []).map(
    r => `${r.conditions.map(atom).join(" & ")} => ${atom(r.conclusion)}`
  );
}

export async function runRuleDischargeTests(): Promise<void> {
  await describe("RULE DISCHARGE - TEXT-LEDGER RULE-HOP (PARITY §3.2)", async () => {
    // ---- 1. Extraction correctness ----------------------------------------

    await it("extracts attribute rules with conjuncts and negations intact", async () => {
      const cases: Array<[string, string[]]> = [
        // Dummy-head generics, incl. the conjunct-drop fix ("nice" used to
        // be silently lost) and negated conclusions.
        ["all nice, blue things are kind", ["VAR.nice & VAR.blue => VAR.kind"]],
        ["nice things are red", ["VAR.nice => VAR.red"]],
        ["round things are not kind", ["VAR.round => !VAR.kind"]],
        // Conditionals: variable and ground subjects, negated conditions.
        [
          "if something is rough and not blue then it is not kind",
          ["VAR.rough & !VAR.blue => !VAR.kind"],
        ],
        ["if dave is rough then dave is kind", ["dave.rough => dave.kind"]],
        [
          "if someone is red and not white then they are smart",
          ["VAR.red & !VAR.white => VAR.smart"],
        ],
        // Relational (SVO) rules, incl. the "chases"[Noun,Plural] mis-tag
        // recovery and mixed attribute+relational conditions.
        [
          "if someone chases the cat then they like the dog",
          ["VAR.chase:cat => VAR.like:dog"],
        ],
        [
          "if someone chases the cat and they see the cat then the cat is young",
          ["VAR.chase:cat & VAR.see:cat => cat.young"],
        ],
        // NOT rules: noun-headed taxonomy and intransitive conditionals.
        ["all men are mortal", []],
        ["cats are mammals", []],
        ["if it rains then the grass grows", []],
      ];
      for (const [text, want] of cases) {
        assert.deepStrictEqual(
          ruleShapes(buildGraphFromText(text)),
          want,
          `rule extraction for "${text}"`
        );
      }
    });

    await it("re-classifies dummy-head generics off the asserted ledger", async () => {
      // The generic's content must live ONLY in the rule (plus hypothetical
      // terrain edges) - no asserted edge or contrast survives.
      const generic = buildGraphFromText("round things are not kind");
      assert.strictEqual(generic.rules?.length, 1);
      assert.ok(
        generic.edges.every(e => e.hypothetical),
        "generic landed no asserted edge"
      );
      assert.strictEqual(
        (generic.contrasts ?? []).length,
        0,
        "generic landed no contrast"
      );
      // Noun-headed control keeps its asserted taxonomy edge.
      const taxonomy = buildGraphFromText("cats are mammals");
      assert.strictEqual(taxonomy.rules?.length, 0);
      assert.ok(
        taxonomy.edges.some(e => !e.hypothetical),
        "taxonomy still lands an asserted edge"
      );
    });

    // ---- 2. Discharge soundness (live ledger) -----------------------------

    await it("discharges rules soundly over the live ledger", async () => {
      const physics = DOPAT_CONFIG.PHYSICS as unknown as {
        TEXT_GRAPH_INGESTION_ENABLED: boolean;
        TEXT_GRAPH_QUERY_ENABLED: boolean;
        TEXT_GRAPH_RULE_DISCHARGE_ENABLED: boolean;
      };
      const prevIngest = physics.TEXT_GRAPH_INGESTION_ENABLED;
      const prevQuery = physics.TEXT_GRAPH_QUERY_ENABLED;
      const prevDischarge = physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED;
      physics.TEXT_GRAPH_INGESTION_ENABLED = true;
      physics.TEXT_GRAPH_QUERY_ENABLED = true;
      physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = true;

      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();
      const resolver = new Traveler(system, atomizer, store);
      const traveler = createTestTraveler(system, atomizer, resolver, store);
      traveler.setGPUEnabled(false);

      try {
        const ask = (q: string) => resolveGraphQuery(q, system, atomizer);
        const say = async (facts: string[]) => {
          for (const f of facts) await traveler.process(f);
        };

        // (1) Modus ponens at depth 1; unrelated predicate stays silent.
        await say(["if something is nice then it is kind.", "bob is nice."]);
        const mp = ask("is bob kind?");
        assert.strictEqual(mp?.answer, "bob is kind", "d1 modus ponens");
        assert.strictEqual(mp?.provenance, "rule-discharge");
        assert.strictEqual(mp?.confidence, 0.85);
        assert.strictEqual(ask("is bob rich?"), null, "unrelated predicate");

        // (2) An undischarged rule affirms NOTHING - neither consequent nor
        // antecedent (the pinned §5 contract, now for copula rules).
        await say(["if fred is loud then fred is rude."]);
        assert.strictEqual(
          ask("is fred rude?"),
          null,
          "undischarged consequent"
        );
        assert.strictEqual(
          ask("is fred loud?"),
          null,
          "undischarged antecedent"
        );

        // (3) Conjunctive antecedent must not fire on partial match.
        await say(["all quiet, green things are gentle.", "carol is quiet."]);
        assert.strictEqual(
          ask("is carol gentle?"),
          null,
          "partial conjunction"
        );
        await say(["carol is green."]);
        assert.strictEqual(
          ask("is carol gentle?")?.answer,
          "carol is gentle",
          "full conjunction fires"
        );

        // (4) Negated condition needs EXPLICIT contrast, never absence.
        await say([
          "if something is rough and not blue then it is not tidy.",
          "fiona is rough.",
        ]);
        assert.strictEqual(
          ask("is fiona tidy?"),
          null,
          "absence of 'blue' must not satisfy 'not blue'"
        );
        await say(["fiona is not blue."]);
        const deny = ask("is fiona tidy?");
        assert.ok(
          deny?.answer.startsWith("no,"),
          `explicit contrast discharges: "${deny?.answer}"`
        );
        assert.strictEqual(deny?.provenance, "rule-discharge");
        assert.ok(
          ask("is fiona not tidy?")?.answer.startsWith("correct,"),
          "negated question phrasing over a derived denial"
        );

        // (5) Negative conclusion feeds DENY.
        await say(["round things are not happy.", "bob is round."]);
        assert.ok(
          ask("is bob happy?")?.answer.startsWith("no,"),
          "derived negative conclusion denies"
        );

        // (6) d2 chaining: rule -> rule.
        await say([
          "brave things are calm.",
          "calm things are steady.",
          "dave is brave.",
        ]);
        assert.strictEqual(
          ask("is dave steady?")?.answer,
          "dave is steady",
          "two-rule chain"
        );

        // (7) Ground-subject rule fires only for its subject.
        await say([
          "if erin is tall then erin is fast.",
          "erin is tall.",
          "gary is tall.",
        ]);
        assert.strictEqual(ask("is erin fast?")?.answer, "erin is fast");
        assert.strictEqual(ask("is gary fast?"), null, "ground-rule scoping");

        // (8) Derived-vs-asserted conflict is SILENCE, not a pick.
        await say([
          "harry is warm.",
          "soft things are not warm.",
          "harry is soft.",
        ]);
        assert.strictEqual(ask("is harry warm?"), null, "conflict -> silence");

        // (9) Rules landed in the rule ledger, not the asserted edge ledger.
        assert.ok(
          system.textGroundedRules.length >= 8,
          `rule ledger populated (${system.textGroundedRules.length})`
        );

        // (10) Asking never creates or mutates.
        const rulesBefore = system.textGroundedRules.length;
        const allocatedBefore = system.length;
        for (const q of [
          "is bob kind?",
          "is fiona tidy?",
          "is dave steady?",
          "is gary fast?",
          "is harry warm?",
        ]) {
          ask(q);
        }
        assert.strictEqual(
          system.textGroundedRules.length,
          rulesBefore,
          "asking must not add rules"
        );
        assert.strictEqual(
          system.length,
          allocatedBefore,
          "asking must not allocate precepts"
        );

        // (11) Flag off -> derived answers vanish, asserted ones stay.
        physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = false;
        assert.strictEqual(ask("is bob kind?"), null, "flag off: no discharge");
        assert.strictEqual(ask("is fiona tidy?"), null);
        assert.strictEqual(ask("is dave steady?"), null);
        assert.strictEqual(
          ask("is bob nice?")?.answer,
          "bob is nice",
          "flag off: asserted readout unchanged"
        );
        physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = true;

        // Live wiring: the full process() path surfaces a discharged answer.
        const live = (await traveler.process("is bob kind?"))
          .toLowerCase()
          .trim();
        assert.ok(
          live.includes("kind") && !live.startsWith("no"),
          `live process() surfaces the discharged answer: "${live}"`
        );

        // ---- Relational (SVO) discharge over the triple ledger ----------

        // (12) Relational modus ponens: variable rule fires on an asserted
        // triple; the conclusion is a derived triple.
        await say([
          "if someone chases the fox then they like the owl.",
          "the wolf chases the fox.",
        ]);
        const rel = ask("does the wolf like the owl?");
        assert.ok(
          rel && !rel.answer.startsWith("no"),
          `relational MP affirms: "${rel?.answer}"`
        );
        assert.strictEqual(rel?.provenance, "rule-discharge");
        assert.strictEqual(
          ask("does the bear like the owl?"),
          null,
          "unbound entity stays silent"
        );

        // (13) Mixed conditions: attribute + relational, incl. a ground
        // condition, with a GROUND conclusion (∃x binding).
        await say([
          "if someone chases the hen and they are sly then the hen is scared.",
          "the ferret chases the hen.",
          "the ferret is sly.",
        ]);
        assert.strictEqual(
          ask("is the hen scared?")?.answer,
          "the hen is scared",
          "ground conclusion via existential binding"
        );

        // (14) Negated relational fact feeds the negated-question readout
        // and blocks nothing else.
        await say(["the crow does not trust the snake."]);
        assert.ok(
          ask("does the crow not trust the snake?")?.answer.startsWith(
            "correct,"
          ),
          "negated triple affirms its negated question"
        );
        assert.strictEqual(
          ask("does the crow trust the snake?")?.answer.startsWith("no,"),
          true,
          "negated triple denies the positive question"
        );

        // (14b) Reflexive derivation IS sound: a variable can unify with an
        // entity named elsewhere in the rule ("if someone sees the lamb
        // then they chase the goat" firing with subject=goat when the goat
        // sees the lamb derives the self-loop chase(goat,goat)), and it
        // must chain into further rules exactly like any other derived
        // fact. Confirmed against gold: every reflexive relational question
        // in data/benchmarks/ruletaker_sample.jsonl ("the cow visits the
        // cow", "the tiger chases the tiger", ...) is gold=true. An earlier
        // version of this suite pinned the OPPOSITE (a guard blocking
        // reflexive derivation) - that guard was wrong and is gone; this
        // case stays as a regression pin against reintroducing it.
        await say([
          "if someone sees the lamb then they chase the goat.",
          "the goat sees the lamb.",
          "if someone is loud and they chase the goat then they need the hay.",
          "the goat is loud.",
        ]);
        assert.ok(
          ask("does the goat chase the goat?")?.answer.includes("goat"),
          "reflexive derivation is believed"
        );
        assert.strictEqual(
          ask("does the goat need the hay?")?.answer,
          "the goat need the hay",
          "a reflexive premise chains into a second rule"
        );

        // ---- Closed-world mode (flagged; parse-completeness valve) ------

        const cwaPhysics = DOPAT_CONFIG.PHYSICS as unknown as {
          TEXT_GRAPH_CWA_ENABLED: boolean;
        };
        cwaPhysics.TEXT_GRAPH_CWA_ENABLED = true;
        try {
          // (15) NAF condition: "not blue" satisfied by non-derivability.
          await say([
            "if something is rough and not blue then it is dull.",
            "kevin is rough.",
          ]);
          assert.strictEqual(
            ask("is kevin dull?")?.answer,
            "kevin is dull",
            "CWA: negation-as-failure discharges the rule"
          );

          // (16) CWA denial: resolved, non-derivable, non-conflicted ->
          // deny instead of silence.
          assert.ok(
            ask("is kevin blue?")?.answer.startsWith("no,"),
            "CWA: non-derivable resolved question denies"
          );

          // (17) Parse-completeness valve: an unparsed sentence forces the
          // whole theory back to open-world silence for CWA-only verdicts.
          const unparsedBefore = system.textGroundedUnparsed;
          groundTextIfEnabled("zzz qqq vvv", system, atomizer);
          assert.ok(
            system.textGroundedUnparsed > unparsedBefore,
            "gibberish increments the unparsed counter"
          );
          assert.strictEqual(
            ask("is kevin blue?"),
            null,
            "CWA denial disabled while the theory is incompletely read"
          );
          // NAF inside the closure is also off the table now: the rule
          // needing "not blue" must no longer fire.
          assert.strictEqual(
            ask("is kevin dull?"),
            null,
            "NAF discharge disabled while the theory is incompletely read"
          );
        } finally {
          cwaPhysics.TEXT_GRAPH_CWA_ENABLED = false;
        }

        // (18) OWA control after CWA section: same questions, flag off ->
        // silence (the CWA verdicts above were mode-dependent, not leaks).
        assert.strictEqual(ask("is kevin dull?"), null, "OWA: no NAF");
      } finally {
        physics.TEXT_GRAPH_INGESTION_ENABLED = prevIngest;
        physics.TEXT_GRAPH_QUERY_ENABLED = prevQuery;
        physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = prevDischarge;
        await store.close();
      }
    });

    // ---- 3. Closed-world completeness guards (2026-07-30) ----------------
    //
    // Both defects below cost only SILENCE under open-world semantics, which
    // is why they survived until CWA removed the margin and turned them into
    // confident falsehoods. Each is pinned here so a regression cannot be
    // rediscovered the expensive way (see data/benchmarks/README.md).

    await it("does not chain through a reified verb node (pairScoped is sticky)", async () => {
      const physics = DOPAT_CONFIG.PHYSICS as unknown as {
        TEXT_GRAPH_INGESTION_ENABLED: boolean;
        TEXT_GRAPH_QUERY_ENABLED: boolean;
      };
      const prevIngest = physics.TEXT_GRAPH_INGESTION_ENABLED;
      const prevQuery = physics.TEXT_GRAPH_QUERY_ENABLED;
      physics.TEXT_GRAPH_INGESTION_ENABLED = true;
      physics.TEXT_GRAPH_QUERY_ENABLED = true;

      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();
      try {
        // The verb node is shared across assertions, so subject->verb->object
        // chaining bridges unrelated facts. The stamp that forbids it used to
        // be CLEARED whenever the same edge recurred in a role that did not
        // set it - and one graph is built per THEORY, so a single recurrence
        // anywhere re-opened the node for every sentence.
        groundTextIfEnabled(
          ["the cat visits the cow", "the cow is kind"],
          system,
          atomizer
        );
        assert.strictEqual(
          resolveGraphQuery("is the cat kind?", system, atomizer),
          null,
          "cat -> visit -> cow -> kind must not affirm 'the cat is kind'"
        );
        // The assertion that IS in the ledger still answers - the guard must
        // remove the bridge, not the facts.
        assert.strictEqual(
          resolveGraphQuery("is the cow kind?", system, atomizer)?.answer,
          "the cow is kind",
          "the asserted attribute still resolves"
        );
      } finally {
        physics.TEXT_GRAPH_INGESTION_ENABLED = prevIngest;
        physics.TEXT_GRAPH_QUERY_ENABLED = prevQuery;
        await store.close();
      }
    });

    await it("interns a multi-word entity to ONE precept across both parsers", async () => {
      const physics = DOPAT_CONFIG.PHYSICS as unknown as {
        TEXT_GRAPH_INGESTION_ENABLED: boolean;
        TEXT_GRAPH_QUERY_ENABLED: boolean;
        TEXT_GRAPH_RULE_DISCHARGE_ENABLED: boolean;
        TEXT_GRAPH_CWA_ENABLED: boolean;
      };
      const prev = {
        i: physics.TEXT_GRAPH_INGESTION_ENABLED,
        q: physics.TEXT_GRAPH_QUERY_ENABLED,
        d: physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED,
      };
      physics.TEXT_GRAPH_INGESTION_ENABLED = true;
      physics.TEXT_GRAPH_QUERY_ENABLED = true;
      physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = true;

      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();
      try {
        // A multi-word entity used to land on TWO precepts: LogicGraph
        // delegation interned the full noun phrase for copula surface
        // ("bald eagle") while the grammatical pass interned the head noun
        // for SVO ("eagle"), splitting the theory's knowledge across precepts
        // the closure treats as unrelated. Head-noun normalisation in
        // GraphBuilder.ensure keeps both parsers on one label.
        //
        // The copula sentence is the one that used to intern the full phrase,
        // and the SVO sentence the head noun; asking via the copula surface
        // must now see what the SVO sentence asserted.
        groundTextIfEnabled(
          ["the bald eagle chases the cat", "the bald eagle is red"],
          system,
          atomizer
        );
        assert.strictEqual(
          resolveGraphQuery("the bald eagle is red?", system, atomizer)?.answer,
          "the bald eagle is red",
          "copula-interned fact resolves under the canonical head"
        );
        // The same fact via the AUX-FRONTED surface. This used to be a
        // separate defect stacked on top of the aliasing one: the
        // subject/predicate split stopped at the first word, so the question
        // canonicalized to "the bald is eagle red" and asked about nothing.
        // Both halves of "one entity, one precept" - the label and the split -
        // are needed for a multi-word entity to survive a real question.
        assert.strictEqual(
          resolveGraphQuery("is the bald eagle red?", system, atomizer)?.answer,
          "the bald eagle is red",
          "aux-fronted question with a multi-word subject resolves too"
        );
        assert.strictEqual(
          resolveGraphQuery("the bald eagle chases the cat?", system, atomizer)
            ?.answer,
          "the bald eagle chases the cat",
          "SVO-interned fact resolves under the same head"
        );
        // Both facts landing on one precept is the invariant; assert it
        // directly so a regression cannot hide behind a phrasing change.
        const ledgerIds = (label: string): number[] =>
          [
            ...system.getIdsByScope(atomizer.getSymbolScope(label, false)),
          ].filter(
            id =>
              system.isAllocated(id) &&
              (system.textGroundedEdges.has(id) ||
                system.textGroundedTripleParticipants.has(id))
          );
        assert.strictEqual(
          ledgerIds("bald eagle").length,
          1,
          "the entity occupies exactly one ledger precept"
        );
      } finally {
        physics.TEXT_GRAPH_INGESTION_ENABLED = prev.i;
        physics.TEXT_GRAPH_QUERY_ENABLED = prev.q;
        physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = prev.d;
        await store.close();
      }
    });

    await it("keeps two entities that share a head noun apart", async () => {
      const physics = DOPAT_CONFIG.PHYSICS as unknown as Record<
        string,
        boolean
      >;
      const prev = {
        i: physics.TEXT_GRAPH_INGESTION_ENABLED,
        q: physics.TEXT_GRAPH_QUERY_ENABLED,
        d: physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED,
      };
      physics.TEXT_GRAPH_INGESTION_ENABLED = true;
      physics.TEXT_GRAPH_QUERY_ENABLED = true;
      physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = true;

      const system = new System();
      const atomizer = new LogicAtomizer();
      await atomizer.init();
      const store = new Store(system, atomizer, ":memory:");
      await store.waitForInit();
      try {
        // The modifier is what distinguishes the birds, and interning only the
        // head pooled them: the ledger held eagle->red AND eagle->blue for what
        // the text says are two animals. Silence under open-world semantics,
        // a confident falsehood under closed-world denial.
        groundTextIfEnabled(
          ["the bald eagle is red", "the golden eagle is blue"],
          system,
          atomizer
        );
        assert.strictEqual(
          resolveGraphQuery("is the bald eagle red?", system, atomizer)?.answer,
          "the bald eagle is red",
          "each bird keeps its own facts"
        );
        assert.ok(
          !resolveGraphQuery(
            "is the bald eagle blue?",
            system,
            atomizer
          )?.answer.startsWith("the bald eagle is blue"),
          "the OTHER bird's colour does not transfer"
        );
        // Subsumption is the compensation for not collapsing: the phrase still
        // reaches its head, so a taxonomy asserted about eagles remains
        // reachable from either bird. Direction is specific -> general only.
        const g = buildGraphFromText("the bald eagle is red");
        const sub = g.edges.find(
          e =>
            g.nodes[e.from].label === "bald eagle" &&
            g.nodes[e.to].label === "eagle"
        );
        assert.ok(sub, "a modified NP subsumes under its head");
        assert.ok(
          sub?.definitional,
          "the subsumption edge is stamped definitional, not asserted"
        );
        // ...and being label-derived, it is not evidence the sentence parsed:
        // multi-word gibberish must still open the parse-completeness valve.
        const before = system.textGroundedUnparsed;
        groundTextIfEnabled("zzz qqq vvv", system, atomizer);
        assert.ok(
          system.textGroundedUnparsed > before,
          "a definitional edge does not make gibberish look parsed"
        );
      } finally {
        physics.TEXT_GRAPH_INGESTION_ENABLED = prev.i;
        physics.TEXT_GRAPH_QUERY_ENABLED = prev.q;
        physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = prev.d;
        await store.close();
      }
    });
  });
}
