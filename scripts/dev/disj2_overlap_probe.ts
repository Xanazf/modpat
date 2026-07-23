import { GridIndex4D } from "@_lib/soa/GridIndex4D";
import LogicAtomizer from "@atomics/LogicAtomizer";
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
    { id: "syll1", src: "all birds are animals. tweety is a bird. tweety |-" },
  ];
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();

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
    const ans = atomizer.decodeSequence(out, system).trim();
    const grid = new GridIndex4D();
    grid.buildFromSystem(system);
    console.log(`\n[${c.id}] ans="${ans}" outIds=[${Array.from(out)}]`);
    for (const oid of out) {
      if (!system.isAllocated(oid)) continue;
      const x = system.posX[oid],
        y = system.posY[oid],
        z = system.posZ[oid],
        w = system.posW[oid];
      const tok = atomizer
        .decodeSequence(new Uint32Array([oid]), system)
        .trim();
      const overlaps: string[] = [];
      for (const j of grid.candidatesInRadius(x, y, z, w, 0.1)) {
        if (j === oid || !system.isAllocated(j)) continue;
        const dx = x - system.posX[j],
          dy = y - system.posY[j],
          dz = z - system.posZ[j],
          dw = w - system.posW[j];
        if (dx * dx + dy * dy + dz * dz + dw * dw < 1e-9)
          overlaps.push(
            `${j}:"${atomizer.decodeSequence(new Uint32Array([j]), system).trim()}"(scope ${system.scope[j]})`
          );
      }
      console.log(
        `  out ${oid} "${tok}" scope=${system.scope[oid]} pos=(${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)},${w.toFixed(2)}) EXACT-OVERLAPS=[${overlaps.join(", ")}]`
      );
    }
  }
  await store.close();
  process.exit(0);
}
main();
