/**
 * Per-item analysis of external-benchmark checkpoints (PARITY §3.2).
 *
 * The pinned `metric_ab.baseline.json` records family-level aggregates only,
 * which is enough to detect a regression but not enough to explain one. The
 * `--checkpoint` files written by `tests/benchmarks/external_benchmarks.ts`
 * carry every item's gold label, verdict, raw answer, and parse-completeness
 * valve reading, so this script answers the two questions the aggregates
 * cannot:
 *
 *   1. WHAT IS THE RESIDUAL MADE OF - abstentions broken down by dataset and
 *      gold class. RuleTaker has no `unknown` gold class (it is closed-world
 *      by construction), so every RuleTaker abstention is a scored miss, and
 *      the gold=false ones are exactly what negation-as-failure would close.
 *
 *   2. WHAT DID A CHANGE ACTUALLY DO - a per-item verdict diff between two
 *      checkpoints, classified into gains (silence -> correct), losses
 *      (correct -> silence), fixes (wrong -> correct/silence), and breaks
 *      (silence/correct -> wrong). The last class is the one the covenant
 *      cares about: the characteristic failure must remain silence.
 *
 * Usage:
 *   tsx scripts/dev/checkpoint_analysis.ts <checkpoint.jsonl>
 *   tsx scripts/dev/checkpoint_analysis.ts <before.jsonl> <after.jsonl>
 */

import { readFileSync } from "node:fs";

type Gold = "true" | "false" | "unknown";
type Verdict = "affirm" | "deny" | "abstain";

interface Rec {
  kind: string;
  id: string;
  ds: string;
  depth: number;
  gold: Gold;
  fastVerdict: Verdict;
  honestVerdict: Verdict;
  honestAnswer: string;
  unparsed?: number;
  sentences?: number;
}

function load(path: string): Map<string, Rec> {
  const out = new Map<string, Rec>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line) as Rec;
    if (rec.kind === "result") out.set(rec.id, rec);
  }
  return out;
}

/** The verdict that scores as correct for a gold label. */
function correctVerdict(gold: Gold): Verdict {
  return gold === "true" ? "affirm" : gold === "false" ? "deny" : "abstain";
}

function pct(a: number, b: number): string {
  return b === 0 ? "  n/a" : `${((a / b) * 100).toFixed(1).padStart(5)}%`;
}

// ---------------------------------------------------------------------------
// Single-checkpoint composition report
// ---------------------------------------------------------------------------

function report(recs: Map<string, Rec>, label: string): void {
  console.log(`\n=== residual composition: ${label} (n=${recs.size}) ===\n`);

  // Abstentions by dataset x gold class.
  const cells = new Map<string, { abstain: number; wrong: number; n: number }>();
  for (const r of recs.values()) {
    const key = `${r.ds}/gold=${r.gold}`;
    const c = cells.get(key) ?? { abstain: 0, wrong: 0, n: 0 };
    c.n++;
    if (r.honestVerdict === "abstain") c.abstain++;
    else if (r.honestVerdict !== correctVerdict(r.gold)) c.wrong++;
    cells.set(key, c);
  }
  console.log("  bucket                     n   abstain   confFalse");
  for (const [key, c] of [...cells.entries()].sort()) {
    console.log(
      `  ${key.padEnd(24)} ${String(c.n).padStart(3)}   ${String(c.abstain).padStart(3)} ${pct(c.abstain, c.n)}   ${String(c.wrong).padStart(3)}`
    );
  }

  // The CWA-target class: RuleTaker gold=false items the engine went silent
  // on. Under open-world semantics these are UNANSWERABLE by construction -
  // OWA cannot deny a fact it merely fails to derive.
  const target = [...recs.values()].filter(
    r =>
      r.ds === "ruletaker" &&
      r.gold === "false" &&
      r.honestVerdict === "abstain"
  );
  const targetEligible = target.filter(r => r.unparsed === 0);
  console.log(
    `\n  CWA-target class (ruletaker, gold=false, abstained): ${target.length}`
  );
  console.log(
    `  ... of which parse-complete (valve open, unparsed===0): ${targetEligible.length}`
  );

  // Parse-completeness valve reach overall - the CEILING on closed-world
  // mode regardless of whether its logic is right.
  const withValve = [...recs.values()].filter(r => r.unparsed !== undefined);
  if (withValve.length > 0) {
    const byDs = new Map<string, { n: number; open: number }>();
    for (const r of withValve) {
      const c = byDs.get(r.ds) ?? { n: 0, open: 0 };
      c.n++;
      if (r.unparsed === 0) c.open++;
      byDs.set(r.ds, c);
    }
    console.log("\n  parse-completeness valve (CWA eligibility ceiling):");
    for (const [ds, c] of [...byDs.entries()].sort()) {
      console.log(
        `  ${ds.padEnd(16)} open=${String(c.open).padStart(3)}/${String(c.n).padEnd(3)} ${pct(c.open, c.n)}`
      );
    }
  } else {
    console.log(
      "\n  (no valve readings in this checkpoint - written before instrumentation)"
    );
  }
}

// ---------------------------------------------------------------------------
// Two-checkpoint diff
// ---------------------------------------------------------------------------

function diff(before: Map<string, Rec>, after: Map<string, Rec>): void {
  console.log("\n=== per-item verdict diff (before -> after) ===\n");
  const classes = {
    gain: [] as string[],
    loss: [] as string[],
    fix: [] as string[],
    broke: [] as string[],
    churn: [] as string[],
  };

  for (const [id, a] of after) {
    const b = before.get(id);
    if (!b) continue;
    if (b.honestVerdict === a.honestVerdict) continue;
    const want = correctVerdict(a.gold);
    const bOk = b.honestVerdict === want;
    const aOk = a.honestVerdict === want;
    const bSilent = b.honestVerdict === "abstain";
    const aSilent = a.honestVerdict === "abstain";
    const line = `  ${id.padEnd(28)} gold=${a.gold.padEnd(7)} ${b.honestVerdict.padEnd(7)} -> ${a.honestVerdict.padEnd(7)} "${a.honestAnswer.slice(0, 34)}"`;

    if (!bOk && aOk) (bSilent ? classes.gain : classes.fix).push(line);
    else if (bOk && !aOk) (aSilent ? classes.loss : classes.broke).push(line);
    else if (!aOk && !aSilent && bSilent) classes.broke.push(line);
    else classes.churn.push(line);
  }

  const order: [keyof typeof classes, string][] = [
    ["broke", "BROKE (now a confident falsehood - the covenant's red line)"],
    ["gain", "GAIN (silence -> correct)"],
    ["fix", "FIX (wrong -> correct)"],
    ["loss", "LOSS (correct -> silence)"],
    ["churn", "CHURN (wrong -> wrong / other)"],
  ];
  for (const [k, title] of order) {
    console.log(`  -- ${title}: ${classes[k].length}`);
    for (const l of classes[k]) console.log(l);
    console.log("");
  }

  const cf = (m: Map<string, Rec>): number =>
    [...m.values()].filter(
      r =>
        r.honestVerdict !== "abstain" &&
        r.honestVerdict !== correctVerdict(r.gold)
    ).length;
  console.log(`  confident falsehoods: ${cf(before)} -> ${cf(after)}`);
}

const [pathA, pathB] = process.argv.slice(2);
if (!pathA) {
  console.error(
    "usage: checkpoint_analysis.ts <checkpoint.jsonl> [<after.jsonl>]"
  );
  process.exit(1);
}
const a = load(pathA);
report(a, pathA);
if (pathB) {
  const b = load(pathB);
  report(b, pathB);
  diff(a, b);
}
