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
 * Cross-band opposition thresholds (step 5). Two bands count as an asserted
 * opposition only when their resultants are near-exactly antipodal (cosine below
 * −0.999) AND comparable in magnitude (smaller/larger > 0.5, so a real cancelling
 * pair, not a tiny stray vs a dominant one). The near-exact cosine is the guard
 * against false positives: lexical antonyms are PLACED at exact antipodes, so they
 * clear it; unrelated grounded concepts do not align to −0.999 by chance.
 */
const ANTIPODE_COS_EPS = -0.999;
const ANTIPODE_MAG_RATIO = 0.5;

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

/**
 * A determinate negated conclusion derived from geometry (step 10): an
 * implication bridge rotated an antecedent band by π (modus tollens), so the
 * antecedent now points opposite its pole and resolves to `¬antecedent`. This is
 * the wave channel's reading of the whole opposition family, not just the
 * fully-cancelled `contradiction` case - and it carries a graded `confidence`
 * (the band's coherence) that the symbolic E1Formula cannot give.
 */
export interface WaveConclusion {
  /** The scope concluded negated (the implication's antecedent). */
  scope: number;
  /** The antecedent band's atom ids. */
  ids: number[];
  /** Normalized directional coherence |net|/Σ(amp·|pos|) of the concluded band -
   *  the graded sink confidence in [0,1] (1 = a clean single phasor). */
  confidence: number;
}

export interface WaveResolution {
  /** A scope band collapsed to |net| ≈ 0 - caller emits `unknown`. */
  contradiction: boolean;
  /** The scope of the first cancelled band, or null. */
  contradictionScope: number | null;
  /** A bridge-derived `¬antecedent` reading (modus tollens), or null. */
  conclusion: WaveConclusion | null;
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
  /** Σ amp·|pos| - the band's total momentum magnitude, the denominator for a
   *  NORMALIZED directional coherence in [0,1] (1 = all atoms in phase, 0 =
   *  fully cancelled), distinct from the |pole|-scaled `coherence` field. */
  absMom: number;
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
      absMom: 0,
      ids: [],
    };
    for (let k = 0; k < 3; k++) b.net[k] += amp * p[k];
    b.absMass += amp;
    b.absMom += amp * magnitude(p);
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
  // A rotated antecedent is the modus-tollens conclusion `¬antecedent` (step 10).
  const rotated = new Set<number>();
  for (const { from, to } of bridges) {
    const src = bands.get(to);
    const dst = bands.get(from);
    const poleTo = poleOf(to);
    if (!src || !dst || !poleTo) continue;
    if (dot(src.net, poleTo) < 0) {
      for (let k = 0; k < 3; k++) dst.net[k] = -dst.net[k]; // π rotation
      rotated.add(from);
    }
  }

  // -- 4. read logic off each band's resultant -------------------------------
  const out: WaveBand[] = [];
  const bandList = [...bands.values()];
  let contradiction = false;
  let contradictionScope: number | null = null;
  let conclusion: WaveConclusion | null = null;
  for (const b of bandList) {
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
    // A band the bridge rotated to point opposite its pole is the modus-tollens
    // conclusion `¬antecedent` - the determinate non-contradiction reading.
    if (rotated.has(b.scope) && negated && conclusion === null) {
      // Normalized directional coherence in [0,1] - 1 when the antecedent band is
      // a single clean phasor, < 1 when its atoms partially cancel.
      const confidence = b.absMom > 0 ? magnitude(b.net) / b.absMom : 0;
      conclusion = { scope: b.scope, ids: b.ids, confidence };
    }
    out.push({ scope: b.scope, ids: b.ids, coherence, negated });
  }

  // -- 5. cross-band opposition (lexical antonyms) ----------------------------
  // Within-band cancellation (step 4) catches "A ∧ ¬A": both atoms share one
  // scope and sum to zero. LEXICAL antonyms ("hot ∧ cold") are DISTINCT concepts
  // in DISTINCT scopes, so they never share a band - but the stance step placed
  // each at the other's antipode, so their band resultants point in OPPOSITE
  // directions. Two bands whose nets are near-antipodal (and comparable in
  // magnitude) are therefore an asserted opposition - a contradiction read off
  // geometry, with no "not" token and no antonym lexicon at resolve time
  // (deliberate antipodal placement is what makes the cosine ≈ −1; unrelated
  // grounded concepts do not line up this exactly).
  if (!contradiction) {
    for (let i = 0; i < bandList.length && !contradiction; i++) {
      const a = bandList[i];
      const magA = magnitude(a.net);
      if (magA < COHERENCE_EPS) continue;
      for (let j = i + 1; j < bandList.length; j++) {
        const b = bandList[j];
        const magB = magnitude(b.net);
        if (magB < COHERENCE_EPS) continue;
        const cos = dot(a.net, b.net) / (magA * magB);
        const ratio = Math.min(magA, magB) / Math.max(magA, magB);
        if (cos < ANTIPODE_COS_EPS && ratio > ANTIPODE_MAG_RATIO) {
          contradiction = true;
          contradictionScope = a.scope;
          break;
        }
      }
    }
  }

  // A contradiction subsumes any negated-conclusion reading (the band cancelled
  // outright), so don't also emit an MT conclusion in that case.
  if (contradiction) conclusion = null;

  return { contradiction, contradictionScope, conclusion, bands: out };
}
