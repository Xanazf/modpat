/**
 * Demoted-path archive index. Aggregates every mechanism manifest so tooling
 * (scripts/dev/attic_status.ts) can report tier and revival readiness. See
 * REGISTRY.md for the human-readable replacement timeline.
 */
import type { DemotedPath } from "./_schema";
import christoffelC4 from "./christoffel-c4/manifest";
import relaxpathBvp from "./relaxpath-bvp/manifest";
import resonancePath from "./resonance-path/manifest";

export * from "./_schema";

export const DEMOTED_PATHS: DemotedPath[] = [
  resonancePath,
  relaxpathBvp,
  christoffelC4,
];
