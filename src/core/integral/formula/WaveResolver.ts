/**
 * WaveResolver - propositional inference as vector-superposition wave collision
 * on atom GEOMETRY, not symbolic rules.
 *
 * Each atom is a phasor: its spatial position (X,Y,Z) is direction (phase) × |mass|
 * (amplitude). Atoms sharing a `scope` occupy one frequency band and interfere by
 * vector addition. Negation is ANTIPODAL position - a term and its negation sit on
 * opposite sides of the manifold (the stance axis, generalised to all axes) - so a
 * term superposed with its negation cancels to the zero vector. A contradiction is
 * therefore DERIVED from geometry (the band collapses to |net| ≈ 0), not declared
 * by a rule. Modus tollens is the same mechanism: an implication couples two bands,
 * and a negated consequent rotates the antecedent band by π.
 *
 * The resolver never dispatches on negation - negation lives entirely in the
 * geometry. It reads `operatorClass` ONLY to parse sentence STRUCTURE (where the
 * implication bridges are), which is grammar, not inference, and is the one place
 * still awaiting a property-encoding of operator role. Variable-vs-operator is
 * already read from a property: |mass| (operators are massive attractors ≈ c²,
 * variables ≈ c).
 *
 * Phase reference: each band's affirmed orientation is its concept's grounded
 * anchor position - a band containing only ¬B must still know B's affirmed pole.
 * Anchors are reference-only; they do NOT participate in the superposition.
 *
 * Counterpart to the pure-symbolic E1Formula (kept as the fast path). See
 * scripts/dev/vector_superposition_probe.ts for the validated reference model.
 */

// OperatorClass codes (mirror helpers/enums.ts; this file stays import-light like
// E1Formula). Only IdentityShift is consulted, and only for bridge structure.
const OC_IDENTITY = 1; // implies / is / are - forms an A⇒B bridge

const COHERENCE_EPS = 1e-6;

/**
 * The phasor is the SPATIAL orientation (X, Y, Z) only. The W axis is excluded
 * on purpose: posW carries temporal age AND the number-line value of numerals
 * (`posW = n × scale`), neither of which is logical phase - a concept negated is
 * a spatial antipode, not a time/value shift. So opposition lives in X/Y/Z and W
 * is preserved untouched (the stance step reflects X/Y/Z and leaves W alone).
 */
type Vec3 = [number, number, number];

export interface WaveBand {
  scope: number;
  ids: number[];
  /** |net| / Σ|mass|: magnitude of the amplitude-weighted mean phasor. 0 = fully
   *  cancelled (contradiction); ≈|pole| when the band's atoms are all in phase. */
  coherence: number;
  /** Net resultant points opposite the concept pole (resolves to a negation). */
  negated: boolean;
}

export interface WaveResolution {
  /** A scope band collapsed to |net| ≈ 0 - caller emits `unknown`. */
  contradiction: boolean;
  /** The scope of the first cancelled band, or null. */
  contradictionScope: number | null;
  bands: WaveBand[];
}

/** Resolves a concept's canonical (affirmed) pole position for a scope band. */
export type PoleResolver = (scope: number) => Vec3 | null;

const posOf = (system: Root.ManifoldView, id: number): Vec3 => [
  system.posX[id],
  system.posY[id],
  system.posZ[id],
];
const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const magnitude = (a: Vec3): number => Math.sqrt(dot(a, a));

/** Operators are massive attractors (≈ c²); variables are near-weightless (≈ c). */
function isContent(system: Root.ManifoldView, id: number): boolean {
  return Math.abs(system.mass[id]) < system.c * system.c * 0.5;
}

/**
 * Default pole resolver: the grounded anchor for the scope (the persistent
 * concept, as opposed to the ephemeral sequence mention). Returns null when no
 * anchor exists, in which case negation can't be read but contradiction still can.
 */
function defaultPole(system: Root.ManifoldView): PoleResolver {
  return (scope: number) => {
    for (const id of system.getIdsByScope(scope)) {
      if (system.groundedPrecepts.has(id) && system.isAllocated(id))
        return posOf(system, id);
    }
    return null;
  };
}

interface BandAccum {
  scope: number;
  net: Vec3;
  absMass: number;
  ids: number[];
}

/**
 * Resolve a token sequence by wave collision. Returns the per-band reading, or
 * null when there is no content to collide (caller defers to E1Formula/settling).
 */
export function resolveWave(
  ids: Uint32Array,
  system: Root.ManifoldView,
  poleOf: PoleResolver = defaultPole(system)
): WaveResolution | null {
  const N = ids.length;
  if (N === 0) return null;

  // -- 1. superpose content atoms into scope-frequency bands -----------------
  const bands = new Map<number, BandAccum>();
  for (let i = 0; i < N; i++) {
    const id = ids[i];
    if (!isContent(system, id)) continue;
    const scope = system.scope[id];
    const amp = Math.abs(system.mass[id]);
    const p = posOf(system, id);
    const b = bands.get(scope) ?? {
      scope,
      net: [0, 0, 0] as Vec3,
      absMass: 0,
      ids: [],
    };
    for (let k = 0; k < 3; k++) b.net[k] += amp * p[k];
    b.absMass += amp;
    b.ids.push(id);
    bands.set(scope, b);
  }
  if (bands.size === 0) return null;

  // -- 2. implication bridges: an IdentityShift couples the band of the nearest
  //       content before it to the band of the nearest content after it --------
  const bridges: { from: number; to: number }[] = [];
  for (let i = 0; i < N; i++) {
    if (system.operatorClass[ids[i]] !== OC_IDENTITY) continue;
    let from = -1;
    let to = -1;
    for (let j = i - 1; j >= 0; j--)
      if (isContent(system, ids[j])) {
        from = system.scope[ids[j]];
        break;
      }
    for (let j = i + 1; j < N; j++)
      if (isContent(system, ids[j])) {
        to = system.scope[ids[j]];
        break;
      }
    if (from !== -1 && to !== -1 && from !== to) bridges.push({ from, to });
  }

  // -- 3. transport: a negated consequent rotates its antecedent band by π -----
  for (const { from, to } of bridges) {
    const src = bands.get(to);
    const dst = bands.get(from);
    const poleTo = poleOf(to);
    if (!src || !dst || !poleTo) continue;
    if (dot(src.net, poleTo) < 0) {
      for (let k = 0; k < 3; k++) dst.net[k] = -dst.net[k]; // π rotation
    }
  }

  // -- 4. read logic off each band's resultant -------------------------------
  const out: WaveBand[] = [];
  let contradiction = false;
  let contradictionScope: number | null = null;
  for (const b of bands.values()) {
    const coherence = b.absMass > 0 ? magnitude(b.net) / b.absMass : 0;
    const pole = poleOf(b.scope);
    const negated = pole ? dot(b.net, pole) < 0 : false;
    // A contradiction needs TWO opposing contributions cancelling, not a single
    // atom that merely happens to sit near the origin - so require ≥2 atoms in
    // the band. This keeps the live pipeline from reading a lone low-position
    // concept as a derived `unknown`.
    if (b.ids.length >= 2 && coherence < COHERENCE_EPS) {
      contradiction = true;
      if (contradictionScope === null) contradictionScope = b.scope;
    }
    out.push({ scope: b.scope, ids: b.ids, coherence, negated });
  }

  return { contradiction, contradictionScope, bands: out };
}
