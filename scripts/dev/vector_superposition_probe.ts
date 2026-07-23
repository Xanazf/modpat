export {}; // isolate module scope (probe defines top-level resolve/Atom)

/**
 * Wave model where the atom's FULL POSITION VECTOR is its phasor.
 *   amplitude/phase of atom i = mass_i · pos_i   (a vector in 4D)
 *   negation = antipodal position (the stance axis, generalised to all axes):
 *              ¬A sits at −pos(A), so A + ¬A cancels to the zero vector.
 *   collision = mass-weighted vector sum within a scope-frequency band.
 *
 * Read logic off the band's resultant:
 *   |net| ≈ 0                         → destructive cancellation → contradiction → unknown
 *   net aligned with canonical pole   → affirmed
 *   net antipodal to canonical pole   → resolves to ¬
 *
 * No OperatorClass dispatch, no phase array - phase IS geometry. This is the
 * model the build targets; the probe checks the physics before we write it.
 */

type Vec = number[];
const add = (a: Vec, b: Vec): Vec => a.map((x, i) => x + b[i]);
const scale = (a: Vec, k: number): Vec => a.map(x => x * k);
const neg = (a: Vec): Vec => a.map(x => -x);
const mag = (a: Vec): number => Math.hypot(...a);
const dot = (a: Vec, b: Vec): number => a.reduce((s, x, i) => s + x * b[i], 0);

interface Atom {
  scope: number;
  pos: Vec; // full position vector = phasor (negation ⇒ antipodal)
  pole: Vec; // the underlying concept's CANONICAL grounded position (the phase reference)
  mass: number; // amplitude weight (|mass|)
  label: string;
}
interface Bridge {
  from: number;
  to: number;
} // implication A⇒B couples the two bands' orientations

function resolve(label: string, atoms: Atom[], bridges: Bridge[] = []) {
  // canonical pole per band = the concept's grounded position (NOT first-seen):
  // a band containing only ¬B must still know B's affirmed orientation.
  const canonical = new Map<number, Vec>();
  const bands = new Map<
    number,
    { net: Vec; absMass: number; labels: string[] }
  >();
  for (const a of atoms) {
    if (!canonical.has(a.scope)) canonical.set(a.scope, a.pole);
    const b = bands.get(a.scope) ?? {
      net: a.pos.map(() => 0),
      absMass: 0,
      labels: [],
    };
    b.net = add(b.net, scale(a.pos, a.mass));
    b.absMass += Math.abs(a.mass);
    b.labels.push(a.label);
    bands.set(a.scope, b);
  }

  // implication: a consequent band resolved to ¬ (net antipodal to its pole)
  // rotates the antecedent band by π - modus tollens as orientation transport.
  for (const br of bridges) {
    const src = bands.get(br.to);
    const dst = bands.get(br.from);
    const poleTo = canonical.get(br.to);
    if (!src || !dst || !poleTo) continue;
    const consequentNegated = dot(src.net, poleTo) < 0;
    if (consequentNegated) dst.net = neg(dst.net); // π rotation onto antecedent
  }

  console.log(`\n${label}`);
  let contradiction = false;
  for (const [scope, b] of bands) {
    const coherence = b.absMass > 0 ? mag(b.net) / b.absMass : 0;
    const pole = canonical.get(scope)!;
    const aligned = dot(b.net, pole);
    let verdict: string;
    if (coherence < 1e-6) {
      verdict = "net≈0 → CONTRADICTION → unknown";
      contradiction = true;
    } else if (aligned < 0) {
      verdict = `resolves to ¬ (coherence=${coherence.toFixed(3)})`;
    } else {
      verdict = `affirmed (coherence=${coherence.toFixed(3)})`;
    }
    console.log(`  band ${scope} {${b.labels.join(",")}}: ${verdict}`);
  }
  console.log(`  => ${contradiction ? "EMITS unknown ✓" : "determinate"}`);
}

const P: Vec = [1, 1, 1, 1]; // a canonical position
const Q: Vec = [1, -1, 0.5, 2]; // a different canonical position

// A ∧ ¬A : ¬A antipodal → vector sum cancels
resolve("A ∧ ¬A", [
  { scope: 100, pos: P, pole: P, mass: 1, label: "A" },
  { scope: 100, pos: neg(P), pole: P, mass: 1, label: "¬A" },
]);

// A ∧ B : different bands → both determinate, no false unknown
resolve("A ∧ B", [
  { scope: 100, pos: P, pole: P, mass: 1, label: "A" },
  { scope: 200, pos: Q, pole: Q, mass: 1, label: "B" },
]);

// ¬¬A : antipode of antipode = original → reinforces A
resolve("¬¬A", [
  { scope: 100, pos: neg(neg(P)), pole: P, mass: 1, label: "¬¬A" },
]);

// (A⇒B) ∧ ¬B : ¬B antipodal to B's pole; bridge rotates band A by π → ¬A
resolve(
  "(A⇒B) ∧ ¬B   (modus tollens, expect band A → ¬)",
  [
    { scope: 100, pos: P, pole: P, mass: 1, label: "A" },
    { scope: 200, pos: neg(Q), pole: Q, mass: 1, label: "¬B" },
  ],
  [{ from: 100, to: 200 }]
);
