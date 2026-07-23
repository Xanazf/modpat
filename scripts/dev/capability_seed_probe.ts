/**
 * Probe: replicate the FINDINGS.md electSkill measurement post-fix.
 * Boots a semantic Runtime and reports, for each SKILL:* scope, the
 * Capability precept electSkill would read as a field source.
 */
import { OperatorClass } from "@core_i/helpers/enums";
import Runtime from "@core_i/Runtime";

async function main() {
  const rt = await Runtime.boot({
    atomizer: "semantic",
    db: ":memory:",
    noTick: true,
    noLifecycle: true,
    skipIdentity: true,
    noWorkers: true,
  });
  await rt.ready;

  const sys = rt.system;
  const atom = rt.atomizer;

  for (const name of [
    "SKILL:LANGUAGE",
    "SKILL:ASSERTION",
    "SKILL:CODE",
    "SKILL:ARITHMETIC",
  ]) {
    const scope = atom.getSymbolScope(name, false);
    let cap = -1;
    const others: number[] = [];
    for (const id of sys.getIdsByScope(scope)) {
      if (sys.operatorClass[id] === OperatorClass.Capability) cap = id;
      else others.push(id);
    }
    if (cap < 0) {
      console.log(`${name}: scope=${scope} NO capability precept (BUG)`);
      continue;
    }
    console.log(
      `${name}: scope=${scope} capId=${cap} posX=${sys.posX[cap].toFixed(1)} ` +
        `posY=${sys.posY[cap].toFixed(1)} opClass=${sys.operatorClass[cap]} ` +
        `mass=${sys.mass[cap].toFixed(1)} (expect ${(sys.c ** 2 * 10).toFixed(1)}) ` +
        `decay=${sys.decayRate[cap]} otherIdsOnScope=${others.length}`
    );
  }

  await rt.dispose();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
