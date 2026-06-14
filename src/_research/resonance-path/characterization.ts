/**
 * Resonance-path characterization guard.
 *
 * DORMANT while the path is quarantined — there is no live mechanism to assert
 * against. The cases (sourced from the manifest) are the contract a revival
 * must satisfy. On revival:
 *   1. restore the mechanism (see recover.sh + manifest.dependencySurface),
 *   2. replace the throw below with calls into the revived perceive entry,
 *   3. register this under tests/ so the cases become live regression guards,
 *   4. flip the manifest tier to "live-demoted".
 *
 * That sequence is exactly the discipline the original resonance path never had
 * — which is why its deletion went unnoticed until R4/R5 had been wrong for
 * months.
 */
import type { CapabilityCase } from "../_schema";
import manifest from "./manifest";

export const CASES: CapabilityCase[] = manifest.characterization ?? [];

export async function runCharacterization(): Promise<never> {
  throw new Error(
    `resonance-path is quarantined: ${CASES.length} capability cases are dormant ` +
      "(no live mechanism). Revive per recover.sh + manifest.dependencySurface, " +
      "wire this guard to the revived perceive entry, then flip the tier to live-demoted."
  );
}
