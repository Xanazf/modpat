import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import { areAntonyms } from "@atomics/AntonymLexicon";

async function main() {
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const ids = atomizer.ingestSequence(
    "either the cat is inside or the cat is outside. the cat is not outside. the cat |-",
    system
  );
  console.log(
    "areAntonyms(inside,outside) =",
    areAntonyms("inside", "outside")
  );
  for (const id of ids) {
    if (!system.isAllocated(id)) continue;
    const tok = atomizer.decodeSequence(new Uint32Array([id]), system).trim();
    console.log(
      `id=${id} "${tok}" scope=${system.scope[id]} opClass=${system.operatorClass[id]} ` +
        `pos=(${system.posX[id].toFixed(2)},${system.posY[id].toFixed(2)},${system.posZ[id].toFixed(2)},${system.posW[id].toFixed(2)})`
    );
  }
  process.exit(0);
}
main();
