export {}; // isolate module scope (probe defines top-level resolve/Atom)

/**
 * Phase-superposition wave model on ATOM PROPERTIES (no OperatorClass dispatch).
 *
 * Each atom is a wave in a scope-frequency band:
 *   amplitude a = |mass| (variables ≈ 1), phase φ ∈ {0, π}.
 * Negation is a π phase flip (a property, parallel to the existing
 * negative-mass-for-conclusions convention in LogicAtomizer). Implication is a
 * directed bridge that transmits the antecedent band's phase to / from the
 * consequent band (gravitational lensing as phase transport).
 *
 * Logic is read off the NET amplitude per scope band:
 *   |net| ≈ 0  on an asserted band  → destructive cancellation → contradiction → unknown
 *   net phase ≈ π                    → the band resolves to its negation
 *
 * Contrast with the transfer-matrix snapshot, whose single asymmetric
 * destructive EDGE could not cancel A ∧ ¬A symmetrically.
 */

interface Atom {
  scope: number; // frequency band / identity
  phase: number; // 0 or π  (negation flips by π)
  amp: number; // |mass|
  label: string;
}
// A directed implication bridge: consequent band inherits antecedent band's
// phase contribution and vice-versa (lensing transports phase along A⇒B).
interface Bridge {
  from: number; // antecedent scope
  to: number; // consequent scope
}

const PI = Math.PI;
const EPS = 1e-6;

function resolve(label: string, atoms: Atom[], bridges: Bridge[] = []) {
  // 1. superpose atoms within each scope band → net complex phasor
  const bands = new Map<number, { re: number; im: number; labels: string[] }>();
  for (const a of atoms) {
    const b = bands.get(a.scope) ?? { re: 0, im: 0, labels: [] };
    b.re += a.amp * Math.cos(a.phase);
    b.im += a.amp * Math.sin(a.phase);
    b.labels.push(a.label);
    bands.set(a.scope, b);
  }

  // 2. lensing: transport phase across implication bridges. The consequent band
  //    being driven to π (¬B) propagates back along B⇒A as a π contribution on
  //    the antecedent band - modus tollens as phase transport.
  for (const br of bridges) {
    const src = bands.get(br.to); // consequent band (where ¬B lives)
    const dst = bands.get(br.from); // antecedent band (A)
    if (!src || !dst) continue;
    const srcPhase = Math.atan2(src.im, src.re);
    const srcMag = Math.hypot(src.re, src.im);
    // if the consequent is negated (phase ≈ π, magnitude small but signed),
    // transmit a π-phase contribution onto the antecedent.
    if (Math.cos(srcPhase) < 0) {
      dst.re += Math.cos(PI) * Math.max(srcMag, 1) * 0.999;
      dst.im += Math.sin(PI) * Math.max(srcMag, 1) * 0.999;
    }
  }

  // 3. read logic off each band's net amplitude / phase
  console.log(`\n${label}`);
  let anyContradiction = false;
  for (const [scope, b] of bands) {
    const mag = Math.hypot(b.re, b.im);
    const phase = Math.atan2(b.im, b.re);
    let verdict: string;
    if (mag < EPS) {
      verdict = "net≈0  → CONTRADICTION (no determinate value) → unknown";
      anyContradiction = true;
    } else if (Math.cos(phase) < -0.5) {
      verdict = `resolves to ¬ (phase≈π, |net|=${mag.toFixed(3)})`;
    } else {
      verdict = `affirmed (|net|=${mag.toFixed(3)})`;
    }
    console.log(`  scope ${scope} {${b.labels.join(",")}}: ${verdict}`);
  }
  console.log(
    `  => ${anyContradiction ? "EMITS unknown ✓ (derived from symmetric cancellation)" : "determinate"}`
  );
}

// A ∧ ¬A : same band, opposite phase → symmetric cancellation
resolve("A ∧ ¬A", [
  { scope: 100, phase: 0, amp: 1, label: "A" },
  { scope: 100, phase: PI, amp: 1, label: "¬A" },
]);

// A ∧ B : different bands, no interference → both determinate (no false unknown)
resolve("A ∧ B", [
  { scope: 100, phase: 0, amp: 1, label: "A" },
  { scope: 200, phase: 0, amp: 1, label: "B" },
]);

// ¬¬A : two π flips compose → 2π ≡ 0 → A survives (no boundary bug)
resolve("¬¬A", [{ scope: 100, phase: 2 * PI, amp: 1, label: "¬¬A" }]);

// (A⇒B) ∧ ¬B : ¬B drives band B to π; bridge transports π onto band A → ¬A
resolve(
  "(A⇒B) ∧ ¬B   (modus tollens, expect band A → ¬)",
  [
    { scope: 100, phase: 0, amp: 1, label: "A" },
    { scope: 200, phase: PI, amp: 1, label: "¬B" },
  ],
  [{ from: 100, to: 200 }]
);
