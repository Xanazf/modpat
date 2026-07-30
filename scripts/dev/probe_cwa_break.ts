/**
 * Isolation probe for the single CWA break, RelNeg-D5-254-12
 * (data/benchmarks/README.md, 2026-07-30).
 *
 * Under closed-world mode the engine DENIED `big(bald eagle)`, which gold
 * says is derivable at depth 5 through a chain whose fourth hop needs
 * negation-as-failure on "the cat is not kind" as an intermediate step.
 * Denial-on-non-derivability is only sound if the closure is COMPLETE, so
 * this probe answers the prior question: did the closure fail to derive it
 * because of the stratification approximation, or because the theory never
 * parsed into rules in the first place?
 *
 * Prints the extracted rules, the closure contents under OWA and CWA, and
 * the verdict for the asked question, so the cause is read off rather than
 * inferred.
 *
 *   tsx scripts/dev/probe_cwa_break.ts
 */

import LogicAtomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG, SYSTEM_CONFIG } from "@config";
import System from "@core_i/System";
import { buildGraphFromText } from "@core_s/grounding/TextGraph";
import { groundTextIfEnabled } from "@core_s/grounding/TextGrounding";
import Store from "@core_s/Memory";
import { resolveGraphQuery } from "@skill_cogi/GraphQuery";

const THEORY = [
  "The bald eagle visits the cat",
  "The cat visits the bald eagle",
  "The cow does not visit the cat",
  "The bald eagle needs the cow",
  "If something needs the cat and the cat is not kind then it needs the bald eagle",
  "The cow is kind",
  "If the dog is kind and the dog needs the bald eagle then the bald eagle is big",
  "If the bald eagle is not big and the bald eagle does not like the cow then the bald eagle visits the cow",
  "The cow needs the cat",
  "If something is kind then it needs the cat",
  "The cow likes the cat",
  "If the cow does not visit the cat then the cat needs the dog",
  "If something needs the dog then the dog is kind",
  "If something is kind and it likes the cat then the cat is cold",
  "The cow is cold",
  "If something visits the cat and it visits the cow then the cow visits the bald eagle",
  "The dog is red",
  "If something does not visit the cow then it is cold",
  "The bald eagle is red",
  "The cat visits the cow",
  "The bald eagle likes the cat",
];

const QUESTION = "the bald eagle is not big?";

async function main(): Promise<void> {
  const physics = DOPAT_CONFIG.PHYSICS as unknown as {
    TEXT_GRAPH_INGESTION_ENABLED: boolean;
    TEXT_GRAPH_RULE_DISCHARGE_ENABLED: boolean;
    TEXT_GRAPH_CWA_ENABLED: boolean;
  };
  physics.TEXT_GRAPH_INGESTION_ENABLED = true;
  physics.TEXT_GRAPH_RULE_DISCHARGE_ENABLED = true;

  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();

  // --- what the parser made of each sentence ---
  console.log("=== per-sentence parse ===");
  for (const s of THEORY) {
    const g = buildGraphFromText(s.toLowerCase());
    const nRules = g.rules?.length ?? 0;
    const nTriples = g.triples?.length ?? 0;
    const nEdges = g.edges.length;
    const nContrasts = g.contrasts?.length ?? 0;
    const landed = g.nodes.length >= 2 && nEdges + nContrasts >= 1;
    console.log(
      `  ${landed ? "ok " : "MISS"} rules=${nRules} triples=${nTriples} edges=${nEdges} contrasts=${nContrasts}  "${s}"`
    );
  }

  groundTextIfEnabled(
    THEORY.map(s => s.toLowerCase()),
    system,
    atomizer
  );
  console.log(
    `\nunparsed=${system.textGroundedUnparsed} sentences=${system.textGroundedSentences} rules=${system.textGroundedRules.length}`
  );

  // No id->symbol reverse map exists on the Atomizer interface, so build one
  // the same way GraphQuery resolves nodes: word -> scope -> allocated ids.
  const names = new Map<number, string>();
  for (const w of new Set(
    THEORY.join(" ").toLowerCase().split(/[^a-z]+/).filter(Boolean)
  )) {
    const scope = atomizer.getSymbolScope(w, false);
    if (scope <= 0) continue;
    for (const id of system.getIdsByScope(scope)) {
      if (system.isAllocated(id) && !names.has(id)) names.set(id, w);
    }
  }
  const label = (id: number): string => names.get(id) ?? `#${id}`;
  console.log("\n=== extracted rules (precept-resolved) ===");
  for (const r of system.textGroundedRules) {
    const tag = (id: number): string => `${label(id)}#${id}`;
    const atom = (a: Grounding.TextRuleAtom): string =>
      `${a.negated ? "!" : ""}${a.subject < 0 ? "VAR" : tag(a.subject)}.${
        a.verb !== undefined ? `${tag(a.verb)}:` : ""
      }${tag(a.predicate)}`;
    console.log(
      `  ${r.conditions.map(atom).join(" & ")} => ${atom(r.conclusion)}`
    );
  }

  // Whole-theory graph: which edges carry which stamps. The ledger excludes
  // hypothetical|pairScoped, so any un-stamped verb->object edge is a leak.
  {
    const g = buildGraphFromText(THEORY.map(s => s.toLowerCase()));
    console.log("\n=== whole-theory graph edges touching 'visit' ===");
    for (const e of g.edges) {
      const f = g.nodes[e.from].label;
      const t = g.nodes[e.to].label;
      if (f !== "visit" && t !== "visit") continue;
      const flags = [
        e.hypothetical ? "hypothetical" : "",
        e.pairScoped ? "pairScoped" : "",
      ]
        .filter(Boolean)
        .join("+");
      console.log(`  ${f.padEnd(8)} -> ${t.padEnd(8)} [${flags || "ASSERTED"}]`);
    }
  }

  console.log("\n=== contrast ledger (asserted denials) ===");
  for (const [a, bs] of system.textGroundedContrasts) {
    console.log(`  ${label(a).padEnd(10)} !- ${[...bs].map(label).join(", ")}`);
  }
  console.log("\n=== triple ledgers ===");
  const tkey = (k: string): string =>
    k
      .split("|")
      .map(x => label(Number(x)))
      .join("|");
  console.log(`  pos: ${[...system.textGroundedTriples].map(tkey).join("  ")}`);
  console.log(
    `  neg: ${[...system.textGroundedTriplesNeg].map(tkey).join("  ")}`
  );

  console.log("\n=== directed ledger (textGroundedEdgesOut) ===");
  for (const [from, tos] of system.textGroundedEdgesOut) {
    console.log(
      `  ${label(from).padEnd(10)} -> ${[...tos].map(label).join(", ")}`
    );
  }
  // Shortest path cat -> kind, if any: this is what holdsPos() consults.
  const idOf = (w: string): number => {
    for (const [id, n] of names) if (n === w) return id;
    return -1;
  };
  const bfsPath = (from: number, to: number): string[] | null => {
    const prev = new Map<number, number>([[from, -1]]);
    let frontier = [from];
    for (let hop = 0; hop < 8 && frontier.length > 0; hop++) {
      const next: number[] = [];
      for (const cur of frontier)
        for (const c of system.textGroundedEdgesOut.get(cur) ?? []) {
          if (prev.has(c)) continue;
          prev.set(c, cur);
          if (c === to) {
            const path: string[] = [];
            for (let n = to; n !== -1; n = prev.get(n) ?? -1) path.unshift(label(n));
            return path;
          }
          next.push(c);
        }
      frontier = next;
    }
    return null;
  };
  // Entity identity: does every mention of "the bald eagle" resolve to ONE
  // precept? GraphQuery picks the FIRST scope member present in a ledger, so
  // two allocated precepts for the same entity silently split the theory.
  console.log("\n=== precepts per entity word ===");
  for (const w of [
    "eagle",
    "bald eagle",
    "bald",
    "cat",
    "dog",
    "cow",
    "big",
    "red",
  ]) {
    const scope = atomizer.getSymbolScope(w, false);
    if (scope <= 0) continue;
    const ids = [...system.getIdsByScope(scope)].filter(id =>
      system.isAllocated(id)
    );
    const inLedger = ids.filter(
      id =>
        system.textGroundedEdges.has(id) ||
        system.textGroundedContrasts.has(id) ||
        system.textGroundedTripleParticipants.has(id)
    );
    console.log(
      `  ${w.padEnd(7)} allocated=[${ids}] inLedger=[${inLedger}] -> picks ${inLedger[0] ?? "none"}`
    );
  }

  console.log("\n=== question graph orientation ===");
  for (const q of ["the bald eagle is not big", "the bald eagle is big"]) {
    const g = buildGraphFromText(q);
    console.log(
      `  "${q}" nodes=[${g.nodes.map(n => n.label)}] edges=[${g.edges
        .map(e => `${g.nodes[e.from].label}->${g.nodes[e.to].label}`)
        .join(",")}] contrasts=[${(g.contrasts ?? [])
        .map(c => `${g.nodes[c.a].label}!-${g.nodes[c.b].label}`)
        .join(",")}]`
    );
  }

  const p = bfsPath(idOf("cat"), idOf("kind"));
  console.log(`\n  BFS cat -> kind: ${p ? p.join(" -> ") : "unreachable"}`);

  // Walk the gold derivation hop by hop to find where the closure stops.
  const CHAIN = [
    "the cat needs the dog?", // hop 1: from asserted negative triple
    "is the dog kind?", // hop 2
    "the dog needs the cat?", // hop 3
    "is the cat kind?", // the NAF pivot - must be NOT derivable
    "the dog needs the bald eagle?", // hop 4: fires only under NAF
    "is the bald eagle big?", // hop 5: the asked fact
  ];
  (SYSTEM_CONFIG as unknown as { DEBUG: boolean }).DEBUG = true;
  for (const cwa of [false, true]) {
    physics.TEXT_GRAPH_CWA_ENABLED = cwa;
    console.log(`\n=== cwa=${cwa} ===`);
    for (const q of CHAIN) {
      const r = resolveGraphQuery(q, system, atomizer);
      console.log(
        `  ${q.padEnd(32)} -> ${r ? `"${r.answer}" (${r.provenance})` : "SILENCE"}`
      );
    }
    const res = resolveGraphQuery(QUESTION, system, atomizer);
    console.log(
      `  ${`ASKED: ${QUESTION}`.padEnd(32)} -> ${
        res ? `"${res.answer}" (${res.provenance})` : "SILENCE"
      }`
    );
  }
  physics.TEXT_GRAPH_CWA_ENABLED = false;
  await store.close();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
