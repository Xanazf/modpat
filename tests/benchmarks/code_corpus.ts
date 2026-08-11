/**
 * The Stage-1 code corpus: "a small code stdlib as AST graphs"
 * (PARITY §6, Stage 1 - exact homomorphisms first).
 *
 * This is the terrain a primed synthesis run gets to stand on. It is the code
 * analogue of a deduction item's THEORY, with one difference that has to stay
 * true or the benchmark is worthless: **no entry here solves a HumanEval
 * problem.** These are generic primitives - the shapes a synthesizer would have
 * to COMPOSE to reach a benchmark answer, never an answer itself. A guard test
 * (`tests/code_benchmark.test.ts`) asserts no corpus function name collides
 * with a benchmark entry point, so the smuggling PARITY §4.5 warns about cannot
 * creep in later by accident.
 *
 * Written in plain JS (no type annotations): `processCode` parses through
 * `abstract-syntax-tree`, whose parser is JavaScript-only.
 *
 * NAMING, and why it is not cosmetic: `sumOf`/`productOf`/`greaterOf` are named
 * around their operation rather than as `add`/`multiply`/`maximum`, because all
 * three of those ARE HumanEval entry points and the guard test rejected them.
 * Only one was true contamination - HumanEval_53 `add(x, y)` is this corpus's
 * two-number addition verbatim - while `multiply` (product of unit digits) and
 * `maximum` (top-k of an array) merely share a name with something else
 * entirely. The rename fixes both cases at once, and the second kind matters
 * more than it looks: a name-surface query for `function multiply` would have
 * retrieved `a * b` and been scored `fail` against unit-digit semantics, which
 * is the right verdict reached for entirely the wrong reason.
 */

export const CODE_CORPUS = `
function sumOf(a, b) { return a + b; }
function subtract(a, b) { return a - b; }
function productOf(a, b) { return a * b; }
function divide(a, b) { return a / b; }
function remainder(a, b) { return a % b; }
function negate(a) { return -a; }
function absolute(a) { if (a < 0) { return -a; } return a; }

function greaterOf(a, b) { if (a > b) { return a; } return b; }
function lesserOf(a, b) { if (a < b) { return a; } return b; }
function equals(a, b) { return a === b; }
function greater(a, b) { return a > b; }
function less(a, b) { return a < b; }

function isEven(n) { return n % 2 === 0; }
function isOdd(n) { return n % 2 === 1; }
function isPositive(n) { return n > 0; }
function isEmpty(items) { return items.length === 0; }

function sum(items) {
  let total = 0;
  for (const item of items) { total = total + item; }
  return total;
}
function count(items) {
  let n = 0;
  for (const item of items) { n = n + 1; }
  return n;
}
function largest(items) {
  let best = items[0];
  for (const item of items) { if (item > best) { best = item; } }
  return best;
}
function smallest(items) {
  let best = items[0];
  for (const item of items) { if (item < best) { best = item; } }
  return best;
}
function contains(items, target) {
  for (const item of items) { if (item === target) { return true; } }
  return false;
}
function reverse(items) {
  const out = [];
  for (let i = items.length - 1; i >= 0; i = i - 1) { out.push(items[i]); }
  return out;
}
function filterPositive(items) {
  const out = [];
  for (const item of items) { if (item > 0) { out.push(item); } }
  return out;
}
function mapDouble(items) {
  const out = [];
  for (const item of items) { out.push(item * 2); }
  return out;
}

function concat(a, b) { return a + b; }
function length(s) { return s.length; }
function upper(s) { return s.toUpperCase(); }
function lower(s) { return s.toLowerCase(); }
function startsWith(s, prefix) { return s.startsWith(prefix); }

const double = (x) => x * 2;
const square = (x) => x * x;
const increment = (x) => x + 1;
`;

/** Function names declared above - used by the anti-smuggling guard. */
export function corpusFunctionNames(): string[] {
  return [
    ...CODE_CORPUS.matchAll(/(?:function|const)\s+([A-Za-z_$][\w$]*)/g),
  ].map(m => m[1]);
}
