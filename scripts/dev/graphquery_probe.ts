import LogicAtomizer from "@atomics/LogicAtomizer";
import { createTestTraveler } from "@core_i/Runtime";
import {
  questionToProposition,
  resolveGraphQuery,
} from "@skill_cogi/GraphQuery";
import System from "@core_i/System";
import Traveler from "@core_i/Traveler";
import Store from "@core_s/Memory";

async function main() {
  // 1. canonicalization
  const cases: [string, string | null][] = [
    ["is felix a mammal?", "felix is a mammal"],
    ["felix is a mammal?", "felix is a mammal"],
    ["would you say felix is a mammal?", "felix is a mammal"],
    ["felix is a mammal, right?", "felix is a mammal"],
    ["is it true that felix is a mammal?", "felix is a mammal"],
    ["does it follow that felix is a mammal?", "felix is a mammal"],
    ["are roses organisms?", "roses are organisms"],
    ["is a rose an organism?", "a rose is an organism"],
    ["would a rose count as an organism?", "a rose is an organism"],
    ["is it the case that roses are organisms?", "roses are organisms"],
    ["does the grass grow?", "the grass grow"],
    ["is the grass growing?", "the grass is growing"],
    ["the grass grows?", "the grass grows"],
    ["so the grass grows, right?", "the grass grows"],
    ["would the grass grow?", "the grass would grow"],
    ["is felix not a fish?", "felix is not a fish"],
    ["can felix fly?", "felix can fly"],
    ["what is felix?", null],
    ["who owns felix?", null],
  ];
  let bad = 0;
  for (const [q, want] of cases) {
    const got = questionToProposition(q);
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? "OK " : "BAD"} "${q}" -> ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  }

  // 2. end-to-end over a live system
  const system = new System();
  const atomizer = new LogicAtomizer();
  await atomizer.init();
  const store = new Store(system, atomizer, ":memory:");
  await store.waitForInit();
  const resolver = new Traveler(system, atomizer, store);
  const traveler = createTestTraveler(system, atomizer, resolver, store);
  traveler.setGPUEnabled(false);

  try {
    for (const fact of [
      "cats are mammals",
      "mammals are animals",
      "felix is a cat",
      "cats are not fish",
      "fish can swim",
    ]) {
      await traveler.process(fact);
    }
    console.log(`\nuniverse size: ${system.textGroundedPrecepts.size}`);

    for (const q of [
      "is felix a mammal?",
      "is felix an animal?",
      "would you say felix is a mammal?",
      "is felix a fish?",
      "is felix not a fish?",
      "is felix hungry?",
      "is rex a mammal?",
      "can felix fly?",
    ]) {
      const direct = resolveGraphQuery(q, system, atomizer);
      const full = await traveler.process(q);
      console.log(
        `Q "${q}"\n   graph: ${direct ? `"${direct.answer}"` : "null"}   process: "${full}"`
      );
    }
  } finally {
    await store.close();
  }
  if (bad > 0) process.exit(1);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
