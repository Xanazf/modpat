/**
 * The code toolkit - verified synthesis (PARITY §3.5).
 *
 * The code domain's standing asset is that its oracle is free: a candidate can
 * be RUN, in a child process that never sees a manifold coordinate. Until now
 * that asset was only ever spent by the benchmark, to score the engine. Here
 * the engine spends it on itself: candidates are assembled from what the vault
 * holds, executed against the request's own examples, and only a candidate that
 * passes is committed. Everything else is silence.
 *
 * WHAT THIS IS NOT, stated plainly so the number it produces cannot be
 * misread. This is not search. It enumerates the patterns the vault already
 * holds and tests them; it does not compose new ones toward a goal, and it has
 * no notion of a behavioural type. It exists to answer one question - **can any
 * composition the current library can express pass a real problem** - because
 * that determines whether the next mechanism should be search or vocabulary.
 * A high number here would mean the library is adequate and only selection was
 * missing; a zero means the vocabulary is the constraint and search over it
 * would have had nothing to find.
 *
 * THE GOAL IS HANDED IN, deliberately. `parseExamples` reads the doctests out
 * of a problem prompt, which is work the Language layer cannot currently do -
 * turning prose into a specification is §3.1 territory. Supplying the parsed
 * goal isolates composition from reading, exactly as the round-trip probe
 * isolated the channel from reading. It is an ablation, not a capability
 * claim, and a toolkit that needed the examples pre-parsed in production would
 * not be finished.
 */

import { runTypeScript } from "@core_s/grounding/CodeBehaviouralFidelity";
import type Store from "@core_s/Memory";
import { detokenizeCode } from "./Coder";

/** One `>>> call` / expected-value pair from a problem's docstring. */
export interface CodeExample {
  /** The call as written, e.g. `has_close_elements([1.0, 2.0], 0.5)`. */
  call: string;
  /** The expected value as a TypeScript literal, e.g. `false`, `[1, 4, 2]`. */
  expected: string;
}

/**
 * Extracts the doctests from a HumanEval-style prompt.
 *
 * Format is uniform across the corpus: a `// >>> <call>` line followed by one
 * or more comment lines holding the expected value, until the next `>>>` or the
 * end of the comment block. Measured: 156 of 159 problems carry these, 443
 * examples in total - the goal was already written down, and the doc-surface
 * reader was discarding it as noise.
 */
export function parseExamples(prompt: string): CodeExample[] {
  const examples: CodeExample[] = [];
  let pending: string | null = null;
  let expected: string[] = [];

  const flush = (): void => {
    if (pending !== null && expected.length > 0) {
      examples.push({ call: pending, expected: expected.join(" ").trim() });
    }
    pending = null;
    expected = [];
  };

  for (const raw of prompt.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("//")) {
      // The comment block ended - the signature follows.
      flush();
      break;
    }
    const body = line.replace(/^\/\/+\s?/, "").trim();
    const call = body.match(/^>>>\s*(.+)$/);
    if (call) {
      flush();
      pending = call[1].trim();
    } else if (pending !== null && body.length > 0) {
      expected.push(body);
    }
  }
  flush();
  return examples;
}

/** A candidate program plus the name it declares. */
export interface Candidate {
  source: string;
  declaredName: string;
  signature: string;
}

/**
 * Builds ONE program that tries every candidate and reports the first to
 * satisfy the examples.
 *
 * Batching is not just an optimization (159 spawns instead of ~5,900): it also
 * keeps each candidate in its own function scope, so candidates that declare
 * the same identifier cannot collide. Each is wrapped in try/catch, so a
 * candidate that throws is simply not the answer.
 *
 * `deepEqual` rather than `deepStrictEqual` deliberately - it is what the
 * official MultiPL-E harness uses, so a candidate is held to the benchmark's
 * own equality, not to a stricter one this file invented.
 *
 * Accepted cost: one non-terminating candidate takes the whole batch down with
 * it, where per-candidate spawns would have lost only that one. The batch
 * timeout bounds the damage to the item, and the alternative is a benchmark too
 * slow to iterate on.
 */
export function verificationProgram(
  candidates: Candidate[],
  entryPoint: string,
  examples: CodeExample[]
): string {
  const assertions = examples
    .map(e => `  assert.deepEqual(${e.call}, ${e.expected});`)
    .join("\n");

  const fns = candidates
    .map((c, i) => {
      const alias =
        c.declaredName && c.declaredName !== entryPoint
          ? `  const ${entryPoint} = ${c.declaredName};\n`
          : "";
      return `function __try${i}() {\n${c.source}\n${alias}${assertions}\n}`;
    })
    .join("\n");

  return (
    "declare var require: any;\n" +
    "const assert = require('node:assert');\n" +
    `${fns}\n` +
    `const __fns: Array<() => void> = [${candidates.map((_, i) => `__try${i}`).join(", ")}];\n` +
    "for (let i = 0; i < __fns.length; i++) {\n" +
    "  try { __fns[i](); process.stdout.write(String(i)); break; } catch {}\n" +
    "}\n"
  );
}

export interface ToolkitResult {
  /** The verified source, ready to be spliced. */
  source: string;
  /** Which stored pattern satisfied the examples. */
  signature: string;
  /** Candidates executed before this one passed. */
  attempts: number;
}

/**
 * Verified synthesis: return a candidate that passes the request's examples, or
 * nothing at all.
 *
 * Every stored code pattern is a candidate. Each is detokenized with its own
 * slot names, aliased to the requested entry point, and executed against the
 * examples; the first that passes is returned. A candidate that throws, fails
 * an assertion, or does not terminate is simply not returned - the covenant's
 * characteristic failure (PARITY §1) is free here, because a candidate that
 * cannot be verified is never emitted in the first place.
 */
export async function verifiedSynthesis(
  store: Store,
  entryPoint: string,
  examples: CodeExample[],
  opts: {
    timeoutMs?: number;
    candidates?: Candidate[];
    /**
     * Examples required before a candidate may be committed. A verifier is
     * only as trustworthy as its specification, and one example is not a
     * specification - it is a single point, which any number of wrong functions
     * pass through. Measured: both of this mode's confident falsehoods came
     * from one-example problems (`smallest` "satisfying" mean_absolute_deviation
     * and add), while all four genuine passes had two or more. 30 of 159
     * problems carry fewer than two, so this trades reach for the covenant on
     * about a fifth of the corpus - the trade PARITY §1 exists to make.
     */
    minExamples?: number;
  } = {}
): Promise<ToolkitResult | null> {
  if (examples.length < (opts.minExamples ?? 2)) return null;
  const candidates = opts.candidates ?? (await candidatePool(store));
  if (candidates.length === 0) return null;

  const program = verificationProgram(candidates, entryPoint, examples);
  const run = runTypeScript(program, opts.timeoutMs ?? 20_000);
  // The program writes the winning index to stdout and nothing otherwise, so
  // "no output" and "crashed" are the same answer: nothing verified.
  if (!run.ok || !run.stdout.trim()) return null;
  const idx = Number(run.stdout.trim());
  if (!Number.isInteger(idx) || idx < 0 || idx >= candidates.length)
    return null;
  return {
    source: candidates[idx].source,
    signature: candidates[idx].signature,
    attempts: candidates.length,
  };
}

/**
 * Every stored code pattern, detokenized once. The pool does not depend on the
 * request, so a caller sweeping many problems should build it once and pass it
 * in - re-deriving it per item is pure waste.
 */
export async function candidatePool(store: Store): Promise<Candidate[]> {
  const patterns = await store.listCodePatterns();
  const pool: Candidate[] = [];
  for (const p of patterns) {
    const bindings = new Map<number, string>();
    p.varNames.forEach((n, i) => {
      if (n) bindings.set(i, n);
    });
    const source = detokenizeCode(p.tokens, bindings);
    if (!source) continue;
    pool.push({
      source,
      declaredName: p.varNames[0] ?? "",
      signature: p.signature,
    });
  }
  return pool;
}
