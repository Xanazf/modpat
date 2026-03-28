import System from "@core_i/System";
import SemanticAtomizer from "@atomics/SemanticAtomizer";

async function test() {
  const system = new System();
  const atomizer = new SemanticAtomizer();
  await atomizer.init();

  const texts = ["fire is red", "Mars is similar to fire", "the red planet is"];
  for (const text of texts) {
    const ids = atomizer.ingestSequence(text, system);
    console.log(
      `"${text}":`,
      Array.from(ids).map(id =>
        atomizer.decodeSequence(new Uint32Array([id]), system)
      )
    );
  }
}

test();
