import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import LogicAtomizer from "@atomics/LogicAtomizer";
import { areAntonyms } from "@atomics/AntonymLexicon";
import { createTestTraveler } from "@core_i/Runtime";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";

async function main() {
  const cases = [
    {
      id: "disj2",
      src: "either the cat is inside or the cat is outside. the cat is not outside. the cat |-",
    },
    { id: "broken1", src: "blorf glik vex |-" },
  ];
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();
  const tok = (id: number) =>
    atomizer.decodeSequence(new Uint32Array([id]), system).trim();

  for (const c of cases) {
    system.reset();
    const t = createTestTraveler(
      system,
      atomizer,
      new Traveler(system, atomizer, store),
      store
    );
    t.setGPUEnabled(false);
    const ids = atomizer.ingestSequence(c.src, system);
    const out = await t.perceive(ids, {});
    const grid = new GridIndex4D();
    grid.buildFromSystem(system);
    console.log(
      `\n[${c.id}] ans="${atomizer.decodeSequence(out, system).trim()}"`
    );
    for (const oid of out) {
      if (!system.isAllocated(oid)) continue;
      const x = system.posX[oid],
        y = system.posY[oid],
        z = system.posZ[oid],
        w = system.posW[oid];
      console.log(
        `  OUT ${oid} "${tok(oid)}" scope=${system.scope[oid]} pos=(${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${w.toFixed(2)})`
      );
      for (const j of grid.candidatesInRadius(x, y, z, w, 0.1)) {
        if (j === oid || !system.isAllocated(j)) continue;
        const dx = x - system.posX[j],
          dy = y - system.posY[j],
          dz = z - system.posZ[j],
          dw = w - system.posW[j];
        if (dx * dx + dy * dy + dz * dz + dw * dw >= 1e-9) continue;
        // antipodal same-scope sibling of j at (-x,-y,-z,w)?
        let sibling = -1;
        for (const k of grid.candidatesInRadius(-x, -y, -z, w, 0.1)) {
          if (!system.isAllocated(k) || system.scope[k] !== system.scope[j])
            continue;
          const ex = -x - system.posX[k],
            ey = -y - system.posY[k],
            ez = -z - system.posZ[k],
            ew = w - system.posW[k];
          if (ex * ex + ey * ey + ez * ez + ew * ew < 1e-9) {
            sibling = k;
            break;
          }
        }
        console.log(
          `    overlap ${j} "${tok(j)}" scope=${system.scope[j]} sameScope=${system.scope[j] === system.scope[oid]} antonym=${areAntonyms(tok(oid), tok(j))} antipodalSibling=${sibling >= 0 ? `${sibling}"${tok(sibling)}"` : "NONE"}`
        );
      }
    }
  }
  await store.close();
  process.exit(0);
}
main();
