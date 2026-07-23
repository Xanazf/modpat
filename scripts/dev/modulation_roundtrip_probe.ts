/**
 * fire × water → steam, and back: does multiplicative MODULATION preserve the
 * constituent waves, so steam can recover both parents?
 *
 * Uses the project's existing (currently unused) FFT (src/_lib/geometry/Waves.ts).
 *
 * Model: a concept = a real oscillation at its scope-frequency band.
 *   fire  = cos(2π f1 t)
 *   water = cos(2π f2 t)
 * Productive synthesis = real-wave multiplication (amplitude modulation):
 *   steam = fire · water = ½[cos(2π(f1+f2)t) + cos(2π(f1−f2)t)]   (two sidebands)
 *
 * Claim under test: steam's spectrum has exactly two lines at |f1±f2|, and from
 * those two lines we recover f1, f2 EXACTLY - f1=(sum+diff)/2, f2=(sum−diff)/2.
 * If true, modulation is the invertible "combine" op (vs lossy superposition).
 *
 * Honesty checks built in:
 *   1. compare against ADDITIVE superposition (fire+water) - show it does NOT
 *      create a recoverable product (its spectrum is just the two originals, i.e.
 *      "both present", not a new synthesized band).
 *   2. round-trip steam back through demodulation and assert f1,f2 recovered.
 */

import { ComplexArray } from "@_lib/geometry/Waves";

const N = 64; // power of two for the radix-2 FFT
const F_FIRE = 5; // integer bins so the lines land exactly (no leakage)
const F_WATER = 3;

const real = (label: string, fn: (t: number) => number): number[] => {
  const s = new Array<number>(N);
  for (let n = 0; n < N; n++) s[n] = fn(n / N);
  void label;
  return s;
};

/** Top spectral lines (bin, magnitude) of a real signal, via the project FFT. */
function spectrum(signal: number[]): { bin: number; mag: number }[] {
  const spec = new ComplexArray(
    signal,
    Float64Array as unknown as ArrayConstructor
  ).FFT();
  const out: { bin: number; mag: number }[] = [];
  // only the lower half is independent for a real signal
  for (let k = 0; k <= N / 2; k++) {
    const r = (spec.real as number[])[k];
    const im = (spec.imag as number[])[k];
    const mag = Math.hypot(r, im);
    if (mag > 1e-6) out.push({ bin: k, mag });
  }
  return out.sort((a, b) => b.mag - a.mag);
}

const fire = real("fire", t => Math.cos(2 * Math.PI * F_FIRE * t));
const water = real("water", t => Math.cos(2 * Math.PI * F_WATER * t));

// -- productive synthesis: MULTIPLY (modulation) ----------------------------
const steam = fire.map((v, n) => v * water[n]);

// -- co-presence: ADD (superposition) ---------------------------------------
const mixed = fire.map((v, n) => v + water[n]);

console.log(
  "fire  spectrum:",
  spectrum(fire).map(s => s.bin)
);
console.log(
  "water spectrum:",
  spectrum(water).map(s => s.bin)
);

const steamLines = spectrum(steam);
console.log(
  "\nsteam = fire × water  →  lines at bins:",
  steamLines.map(s => `${s.bin}(${s.mag.toFixed(2)})`)
);
const sidebands = steamLines.map(s => s.bin).sort((a, b) => a - b);
const [diff, sum] = sidebands; // |f1−f2| and f1+f2
const recFire = (sum + diff) / 2;
const recWater = (sum - diff) / 2;
console.log(
  `  demodulate: sum=${sum}, diff=${diff}  →  recover fire=${recFire}, water=${recWater}`
);
const recovered =
  sidebands.length === 2 &&
  new Set([recFire, recWater]).size === 2 &&
  ((recFire === F_FIRE && recWater === F_WATER) ||
    (recFire === F_WATER && recWater === F_FIRE));
console.log(
  `  → ${recovered ? "BOTH PARENTS RECOVERED ✓ (modulation is invertible)" : "recovery FAILED"}`
);

const mixedLines = spectrum(mixed)
  .map(s => s.bin)
  .sort((a, b) => a - b);
console.log(
  "\nmixed = fire + water  →  lines at bins:",
  mixedLines,
  mixedLines.length === 2 &&
    mixedLines[0] === F_WATER &&
    mixedLines[1] === F_FIRE
    ? "→ just the two originals superposed (no new synthesized band; 'both present', not 'steam')"
    : ""
);

// -- round-trip: reconstruct steam from ONLY its two recovered parents -------
const reFire = real("reFire", t => Math.cos(2 * Math.PI * recFire * t));
const reWater = real("reWater", t => Math.cos(2 * Math.PI * recWater * t));
const reSteam = reFire.map((v, n) => v * reWater[n]);
let maxErr = 0;
for (let n = 0; n < N; n++)
  maxErr = Math.max(maxErr, Math.abs(reSteam[n] - steam[n]));
console.log(
  `\nround-trip: rebuild steam from recovered parents, max error = ${maxErr.toExponential(2)}  ${maxErr < 1e-9 ? "✓" : "✗"}`
);
