/**
 * lexical_antonym_probe.ts - validate roadmap step 9 end to end.
 *  (1) opposed-pair manifold distance >> neutral-pair distance
 *  (2) the WaveResolver reads "hot and cold" as a contradiction (no "not" token)
 *  (3) a non-antonym pair ("hot and water") does NOT collapse
 */
import Atomizer from "@atomics/LogicAtomizer";
import { resolveWave } from "@core_i/formula/WaveResolver";
import System from "@core_i/System";

function dist(sys: System, a: number, b: number): number {
  const dx = sys.posX[a] - sys.posX[b];
  const dy = sys.posY[a] - sys.posY[b];
  const dz = sys.posZ[a] - sys.posZ[b];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

async function run() {
  const atomizer = new Atomizer();
  await atomizer.init();

  const pairDist = async (phrase: string, wa: string, wb: string) => {
    const sys = new System();
    const ids = atomizer.ingestSequence(phrase, sys);
    const sa = atomizer.getSymbolScope(wa);
    const sb = atomizer.getSymbolScope(wb);
    const ia = Array.from(ids).find(id => sys.scope[id] === sa)!;
    const ib = Array.from(ids).find(id => sys.scope[id] === sb)!;
    return { d: dist(sys, ia, ib), sys, ids };
  };

  const hotCold = await pairDist("hot and cold", "hot", "cold");
  const hotWater = await pairDist("hot and water", "hot", "water");
  const trueFalse = await pairDist("true and false", "true", "false");

  console.log("opposed   hot/cold   distance:", hotCold.d.toFixed(4));
  console.log("opposed   true/false distance:", trueFalse.d.toFixed(4));
  console.log("neutral   hot/water  distance:", hotWater.d.toFixed(4));

  const w1 = resolveWave(hotCold.ids, hotCold.sys);
  const w2 = resolveWave(hotWater.ids, hotWater.sys);
  const w3 = resolveWave(trueFalse.ids, trueFalse.sys);
  console.log("\nWaveResolver:");
  console.log("  hot ∧ cold   contradiction:", w1?.contradiction);
  console.log("  true ∧ false contradiction:", w3?.contradiction);
  console.log(
    "  hot ∧ water  contradiction:",
    w2?.contradiction,
    "(must be false)"
  );
}

run();
