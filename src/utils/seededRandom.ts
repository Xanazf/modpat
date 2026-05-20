/**
 * Mulberry32 - fast 32-bit seeded PRNG.
 *
 * Replaces bare Math.random() calls so CI runs are deterministic:
 * same DOPAT_CONFIG.SEED + same corpus → identical traversal paths.
 *
 * Call seedRandom() once at boot (Runtime.boot).  All downstream callers
 * import random() in place of Math.random().
 */

let _state = 0;

export function seedRandom(seed: number): void {
  _state = seed >>> 0;
}

export function random(): number {
  _state = (_state + 0x6d2b79f5) | 0;
  let t = Math.imul(_state ^ (_state >>> 15), 1 | _state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
