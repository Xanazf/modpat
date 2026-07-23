export {}; // isolate module scope (probe defines top-level run())

/**
 * Numerically reproduce the resonance-path contradiction readout (the reduced
 * "minimal slice": matrix build → forward propagation → sink-strength → ≤0 test)
 * with the ORIGINAL recovered weights, to verify the capability-diff claim that
 * `A ∧ ¬A` derives `unknown` via destructive cancellation (maxNetEnergy ≤ 0).
 *
 * Pure arithmetic, no manifold. Operators get scope 0 (excluded from coupling);
 * the two `A` tokens share a content scope.
 */

const W_CONSTRUCTIVE = 1.0;
const W_DESTRUCTIVE = -1.0;
const W_LENSING = 0.7;
const ALPHA = 0.85;
const ITERS = 10;

// OperatorClass codes (mirror enums.ts)
const NONE = 0;
const IDENTITY = 1;
const CONJ = 2;
const SINK = 3;
const INVERSION = 6;

function run(label: string, opClass: number[], scope: number[]) {
  const N = opClass.length;
  const W = new Float64Array(N * N);

  // same-scope constructive + inversion destructive
  for (let i = 0; i < N; i++) {
    const sc = scope[i];
    for (let j = 0; j < N; j++) {
      if (i !== j && scope[j] === sc && sc !== 0) {
        W[i * N + j] = Math.max(W[i * N + j], W_CONSTRUCTIVE);
      }
    }
    if (i > 0 && i < N - 1) {
      if (opClass[i] === IDENTITY) {
        // gravitational lensing: A ⇒ B bridge (mass/c² assumed ≈ 1 here)
        W[(i - 1) * N + (i + 1)] = W_LENSING;
      } else if (opClass[i] === INVERSION) {
        W[i * N + (i + 1)] = W_DESTRUCTIVE;
      }
    }
  }

  // modus-tollens back-coupling: trailing "not B" writes −W_LENSING onto the
  // B→A bridge of any "A implies B".
  for (let i = 0; i < N - 1; i++) {
    if (opClass[i] !== INVERSION || opClass[i + 1] !== NONE) continue;
    const negatedScope = scope[i + 1];
    for (let j = 1; j < N - 1; j++) {
      if (
        opClass[j] === IDENTITY &&
        j + 1 < N - 1 &&
        scope[j + 1] === negatedScope
      ) {
        const bPos = j + 1;
        const aPos = j - 1;
        const backVal = -W_LENSING;
        if (W[bPos * N + aPos] > backVal) W[bPos * N + aPos] = backVal;
      }
    }
  }

  // row-normalize + constructive floor
  const floor = W_CONSTRUCTIVE / (N + 1);
  for (let i = 0; i < N; i++) {
    let rowSum = 0;
    for (let j = 0; j < N; j++) rowSum += Math.abs(W[i * N + j]);
    if (rowSum > 0) for (let j = 0; j < N; j++) W[i * N + j] /= rowSum;
    const sc = scope[i];
    if (sc !== 0) {
      for (let j = 0; j < N; j++) {
        if (
          i !== j &&
          scope[j] === sc &&
          W[i * N + j] > 0 &&
          W[i * N + j] < floor
        )
          W[i * N + j] = floor;
      }
    }
  }

  // forward propagation: accumulated = Σ α^{m-1} W^m
  const acc = new Float64Array(W);
  let cur = new Float64Array(W);
  for (let step = 1; step < ITERS; step++) {
    const next = new Float64Array(N * N);
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        let s = 0;
        for (let k = 0; k < N; k++) s += cur[i * N + k] * W[k * N + j];
        next[i * N + j] = s * ALPHA;
        acc[i * N + j] += next[i * N + j];
      }
    cur = next;
  }

  // sink-strength over None candidates
  let maxNet = -Infinity;
  const rows: string[] = [];
  const cand: { pos: number; strength: number }[] = [];
  for (let j = 0; j < N; j++) {
    if (opClass[j] !== NONE) continue;
    let incoming = 0;
    let outbound = 0;
    for (let i = 0; i < N; i++)
      if (i !== j) {
        incoming += acc[i * N + j];
        outbound += acc[j * N + i];
      }
    const strength = incoming / (1 + outbound);
    cand.push({ pos: j, strength });
    rows.push(
      `  cand pos${j}: incoming=${incoming.toFixed(4)} outbound=${outbound.toFixed(4)} strength=${strength.toFixed(4)}`
    );
    if (strength > maxNet) maxNet = strength;
  }

  // modus-tollens readout: least-energised non-directly-negated candidate.
  const negatedScopes = new Set<number>();
  for (let i = 0; i < N - 1; i++)
    if (opClass[i] === INVERSION && opClass[i + 1] === NONE)
      negatedScopes.add(scope[i + 1]);
  let mtConclusion = "(none)";
  if (negatedScopes.size > 0) {
    let minS = -1e-9;
    let pick = -1;
    for (const c of cand)
      if (!negatedScopes.has(scope[c.pos]) && c.strength < minS) {
        minS = c.strength;
        pick = c.pos;
      }
    if (pick !== -1)
      mtConclusion = `¬(pos${pick})  [least-energised non-negated, strength=${minS.toFixed(4)}]`;
  }

  console.log(`\n${label}`);
  for (const r of rows) console.log(r);
  console.log(`  MT readout: ${mtConclusion}`);
  console.log(
    `  => maxNetEnergy=${maxNet.toFixed(4)}  ${maxNet <= 0 ? "EMITS unknown" : "returns a conclusion"}`
  );
}

// A && not A |-   →  positions: A, &&, not, A, |-
run(
  "A ∧ ¬A ⊢   [A, &&, not, A, |-]",
  [NONE, CONJ, INVERSION, NONE, SINK],
  [100, 0, 0, 100, 0]
);

// sanity: A && B |-  (no contradiction) should NOT emit unknown
run(
  "A ∧ B ⊢    [A, &&, B, |-]  (control, distinct scopes)",
  [NONE, CONJ, NONE, SINK],
  [100, 0, 200, 0]
);

// modus tollens: (A ⇒ B) ∧ ¬B ⊢ ¬A
// positions: A, implies, B, &&, not, B, |-
run(
  "(A⇒B) ∧ ¬B ⊢   [A, implies, B, &&, not, B, |-]  (expect ¬A)",
  [NONE, IDENTITY, NONE, CONJ, INVERSION, NONE, SINK],
  [100, 0, 200, 0, 0, 200, 0]
);

// double negation: not not A |-   (expect A survives, two sign flips compose)
// positions: not, not, A, |-
run(
  "¬¬A ⊢   [not, not, A, |-]  (expect A survives)",
  [INVERSION, INVERSION, NONE, SINK],
  [0, 0, 100, 0]
);
