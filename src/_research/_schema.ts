/**
 * Demoted-path archive schema.
 *
 * A "demoted path" is a mechanism that was once primary and has since been
 * superseded. The cardinal rule of this archive (see REGISTRY.md): a primary
 * mechanism is NEVER deleted, only demoted - so a superseded idea keeps its
 * code, its provenance, the capability it uniquely had, and a guard that
 * detects when it could come back. This is the ablation archive of the
 * research: alternatives kept WITH their measurements, not dropped into git's
 * memory hole (which is how the resonance path silently regressed for months).
 */

export type DemotionTier =
  /** Still compiles and is wired behind a rollback flag; its guard test runs live. */
  | "live-demoted"
  /** Dependencies were removed; cannot compile in-tree; preserved as snapshot + recovery pointer. */
  | "quarantined"
  /** Deliberately set aside for a MEASURED reason; kept for the record, not expected back. */
  | "retired";

/** A dependency the revived mechanism needs, plus a literal probe to test its presence. */
export interface DependencyProbe {
  id: string;
  description: string;
  /** Where the dependency lives if present, and a literal substring to find in that file. */
  locate: { file: string; pattern: string };
}

/** One capability the demoted path had - the spec a revival must satisfy. */
export interface CapabilityCase {
  id: string;
  /** The inference this case exercises (e.g. "contradiction A ∧ ¬A"). */
  inference: string;
  /** Human-readable input. */
  input: string;
  /** What the demoted path produces / a revival must reproduce. */
  expected: string;
  /** What the current primary does instead - i.e. the gap that justifies keeping this. */
  supersededBehavior: string;
}

export interface DemotedPath {
  /** kebab-case; matches the folder name under src/_research/. */
  name: string;
  tier: DemotionTier;
  /** Commit / ref / dated marker at which it stopped being primary. */
  demotedAt: string;
  /** ISO date. */
  demotedOn: string;
  /** What is primary in its place now. */
  supersededBy: string;
  /** live-demoted: the flag that restores it. */
  rollbackFlag?: string;
  /** quarantined: git ref to recover from (recover.sh reproduces the snapshot/). */
  recoveryRef?: string;
  /** retired: the measured reason it was set aside. */
  retirementReason?: string;
  /**
   * THE load-bearing field. What this mechanism does that `supersededBy` cannot.
   * The thing whose absence let R4/R5 regress unnoticed: nobody had written down
   * what was being given up. If a path has no capabilityDelta, it should have
   * been deleted, not archived.
   */
  capabilityDelta: string;
  /** Pointer to the capability-diff writeup, relative to the path folder. */
  capabilityDiff?: string;
  /** Condition under which you would revive it. */
  revivalTrigger: string;
  /** Deps that must exist to compile/run the revived path. Probed by attic_status. */
  dependencySurface: DependencyProbe[];
  /** The guard: what a revival must satisfy. Dormant while quarantined/retired. */
  characterization?: CapabilityCase[];
}

/** Identity helper for type-checked manifests at the definition site. */
export function defineDemotedPath(p: DemotedPath): DemotedPath {
  return p;
}
