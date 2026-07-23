/**
 * Revival-readiness report for the demoted-path archive (src/_research).
 *
 *   tsx scripts/dev/attic_status.ts
 *
 * For each demoted mechanism it prints the tier. For quarantined paths it probes
 * the declared dependency surface against the live tree and reports either
 * REVIVAL-READY (every dependency present) or QUARANTINED (n missing), naming
 * what is missing. This is the check that would have flagged the resonance path
 * the day its dependencies came back.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMOTED_PATHS, type DependencyProbe } from "@src/_research/index";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PAD = 18;
const indent = " ".repeat(PAD);

function present(probe: DependencyProbe): boolean {
  const file = resolve(ROOT, probe.locate.file);
  return (
    existsSync(file) &&
    readFileSync(file, "utf8").includes(probe.locate.pattern)
  );
}

console.log("\nDemoted-path archive status\n");

for (const path of DEMOTED_PATHS) {
  let status: string;
  if (path.tier === "live-demoted") {
    status = `LIVE-DEMOTED   flag ${path.rollbackFlag ?? "(none)"}`;
  } else if (path.tier === "retired") {
    status = "RETIRED";
  } else {
    const missing = path.dependencySurface.filter(d => !present(d));
    const total = path.dependencySurface.length;
    status =
      missing.length === 0
        ? `REVIVAL-READY  (${total}/${total} deps present)`
        : `QUARANTINED    (${missing.length}/${total} deps missing: ${missing
            .map(m => m.id)
            .join(", ")})`;
  }

  console.log(`${path.name.padEnd(PAD)}${status}`);
  console.log(`${indent}superseded by: ${path.supersededBy}`);
  console.log(`${indent}since: ${path.demotedOn} (${path.demotedAt})`);
  if (path.tier === "retired" && path.retirementReason) {
    console.log(`${indent}reason: ${path.retirementReason}`);
  }
  console.log();
}
