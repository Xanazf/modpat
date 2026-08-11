/**
 * CodeBehaviouralFidelity - Phase 4.5, the survey loop's CODE channel.
 *
 * The arithmetic channel (BehaviouralFidelity.ts) closed the loop where ground
 * truth is free, but its evaluator is in-process JavaScript - a skeptic can say
 * the test smuggled the answer in. This channel removes that objection: the
 * territory's answer comes from RUNNING THE TYPESCRIPT through `tsx`, in a child
 * process that never sees a manifold coordinate.
 *
 *   - GEOMETRY predicts:  a function `(): number => a OP b` reduces to the node
 *     reached by composing the operands' grounded W positions (beta-reduction as
 *     traversal on the number line) - exactly the arithmetic prediction, but now
 *     the prediction is about the BEHAVIOUR of a real program, not a bare sum.
 *   - TERRITORY answers:  the same functions are emitted as a TypeScript file,
 *     executed by `tsx`, and their applied results are read back. The parser
 *     never sees a runtime value, so this is fidelity-to-behaviour, non-circular
 *     by construction - "the first fidelity number the parser cannot smuggle in".
 *
 * A mismatch is a terrain defect with an address (the operand precepts), so the
 * repair is local, and reuses BehaviouralFidelity's localize/repair machinery -
 * the only thing that changes is WHO answers for the truth: execution, not math.
 *
 * The executable result is constant across coordinate repairs (the source text
 * does not change when we move a precept), so the loop runs `tsx` ONCE and
 * re-measures cheaply against the cached actuals.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { numberFromW } from "@skill_cogi/Reduction";
import {
  localizeDivergences,
  preceptForSymbol,
  repairPrecept,
} from "./BehaviouralFidelity";

/** Parses "a + b" / "a - b" into operands and operator, or null. */
function parseBinary(
  expr: string
): { aVal: number; bVal: number; op: "+" | "-" } | null {
  const m = expr.trim().match(/^(-?\d+)\s*([+-])\s*(-?\d+)$/);
  if (!m) return null;
  return { aVal: Number(m[1]), bVal: Number(m[3]), op: m[2] as "+" | "-" };
}

/**
 * Runs a self-contained TypeScript program and reports whether it completed.
 *
 * The generic form of this file's argument: the territory answers by RUNNING,
 * in a child process that never sees a manifold coordinate. Used both by the
 * arithmetic channel below and by the code toolkit's verifier, which is the
 * point at which "tsx execution = free territory contact" (PARITY §3.5) stops
 * being an asset the architecture merely claims and starts being one it spends.
 */
export function runTypeScript(
  source: string,
  timeoutMs = 10_000
): { ok: boolean; stdout: string; stderr: string } {
  const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
  if (!existsSync(tsxBin)) {
    throw new Error(`code channel: tsx binary not found at ${tsxBin}`);
  }
  const dir = mkdtempSync(join(tmpdir(), "modpat-verify-"));
  const file = join(dir, "candidate.ts");
  try {
    writeFileSync(file, source);
    const stdout = execFileSync(tsxBin, [file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    return { ok: true, stdout: String(stdout ?? ""), stderr: "" };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return {
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? ""),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Runs the expressions as real TypeScript through `tsx` and returns the applied
 * results. Each expression becomes a typed nullary arrow function that is then
 * CALLED (the beta-reduction step), so the territory's answer is the behaviour
 * of an executed program, not a value computed inside this process.
 *
 * One spawn for the whole batch; the source text is independent of the manifold,
 * so the caller can reuse these actuals across every coordinate repair.
 */
export function executeExpressions(exprs: string[]): number[] {
  const fns = exprs.map(e => `  (): number => (${e})`).join(",\n");
  const program =
    `const __fns: Array<() => number> = [\n${fns}\n];\n` +
    `process.stdout.write(JSON.stringify(__fns.map(f => f())));\n`;

  // tsx lives in node_modules/.bin; tests and dev scripts run from the repo root.
  const tsxBin = join(process.cwd(), "node_modules", ".bin", "tsx");
  if (!existsSync(tsxBin)) {
    throw new Error(`code channel: tsx binary not found at ${tsxBin}`);
  }
  const out = execFileSync(tsxBin, ["--eval", program], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out.trim());
  if (!Array.isArray(parsed) || parsed.length !== exprs.length) {
    throw new Error("code channel: tsx output did not match the batch");
  }
  return parsed.map(Number);
}

/**
 * Behavioural fidelity for the code channel: geometry predicts each function's
 * reduct from grounded W positions; `actuals` is what executing the TypeScript
 * returned. Cases carry the operand addresses for localization, in the same
 * ArithCase shape BehaviouralFidelity's localizer already consumes.
 */
export function codeBehaviouralFidelity(
  exprs: string[],
  actuals: number[],
  system: Root.ManifoldView,
  atomizer: Atomic.Engine
): Grounding.BehaviouralReport {
  const cases: Grounding.ArithCase[] = [];
  for (let k = 0; k < exprs.length; k++) {
    const parsed = parseBinary(exprs[k]);
    if (!parsed) continue;
    const aId = preceptForSymbol(system, atomizer, String(parsed.aVal));
    const bId = preceptForSymbol(system, atomizer, String(parsed.bVal));
    if (aId === -1 || bId === -1) continue;

    const wA = system.posW[aId];
    const wB = system.posW[bId];
    const predicted = numberFromW(parsed.op === "+" ? wA + wB : wA - wB);
    const actual = actuals[k];
    cases.push({
      expr: exprs[k],
      aId,
      bId,
      aVal: parsed.aVal,
      bVal: parsed.bVal,
      op: parsed.op,
      predicted,
      actual,
      match: predicted === actual,
    });
  }
  const matched = cases.filter(c => c.match).length;
  return {
    total: cases.length,
    matched,
    fidelity: cases.length > 0 ? matched / cases.length : 1,
    cases,
    divergences: cases.filter(c => !c.match),
  };
}

/**
 * The code-channel survey loop. Executes the batch ONCE (the territory), then
 * runs the same predict -> localize -> repair -> re-measure cycle the arithmetic
 * loop does, but every re-measurement scores fresh geometry against the cached
 * executed truth. Monotone: a repair that does not reduce divergences is
 * reverted and the loop stops.
 */
export function codeSurveyLoop(
  exprs: string[],
  system: Root.ManifoldView,
  atomizer: Atomic.Engine,
  options: { maxRepairs?: number; actuals?: number[] } = {}
): Grounding.CodeSurveyResult {
  const maxRepairs = options.maxRepairs ?? 4;
  const actuals = options.actuals ?? executeExpressions(exprs);

  const before = codeBehaviouralFidelity(exprs, actuals, system, atomizer);
  let current = before;
  const repairs: Grounding.Suspect[] = [];

  while (current.fidelity < 1 && repairs.length < maxRepairs) {
    const suspects = localizeDivergences(current, system, atomizer).filter(
      s =>
        s.consensus >= 0.5 &&
        (s.failCount >= 2 || current.divergences.length === 1)
    );
    if (suspects.length === 0) break;

    let applied: Grounding.Suspect | null = null;
    let next = current;
    for (const s of suspects) {
      repairPrecept(system, s.id, s.suggestedW);
      const candidate = codeBehaviouralFidelity(
        exprs,
        actuals,
        system,
        atomizer
      );
      if (candidate.divergences.length < current.divergences.length) {
        applied = s;
        next = candidate;
        break;
      }
      repairPrecept(system, s.id, s.currentW);
    }
    if (!applied) break;
    repairs.push(applied);
    current = next;
  }

  return {
    before,
    after: current,
    repairs,
    converged: current.fidelity === 1,
    actuals,
  };
}
