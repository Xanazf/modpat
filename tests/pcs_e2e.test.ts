import { it, describe, TestHarness } from "./utils/harness";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import Unfolder from "@core_s/Unfolder";
import Synthesizer from "@core_i/Synthesizer";
import { OperatorClass } from "@core_i/System";
import assert from "assert";

async function executeE2ETest() {
  await describe("Physicalized Code Synthesis (PCS) 4D Contextual Loom E2E", async () => {
    const env = await TestHarness.getEnvironment<SemanticAtomizer>("semantic");
    const { system, atomizer, resolver } = env;
    system.reset();

    // Inject Unfolder
    const unfolder = new Unfolder(system, atomizer);
    resolver.setUnfolder(unfolder);

    await it("Should autonomously structure a coherent TypeScript function via 4D Contextual Looming", async () => {
      // 1. Unified Sequential Seeding
      // Everything is seeded in a single pass to guarantee monotonic posY.
      const seed =
        "function calculate ( x : number , y : number ) { return x + y } executable_code |-";
      const atomIds = atomizer.ingestSequence(seed, system);

      for (const id of Array.from(atomIds)) {
        system.mass[id] = 1000.0;
        system.update(id);
      }

      // 2. Inquiry using the EXACT IDs from the seed
      const inputIds = new Uint32Array([
        atomIds[0], // function
        atomIds[1], // calculate
        atomIds[3], // x
        atomIds[7], // y
        atomIds[18], // |-
      ]);

      // 3. Resolve
      const resolvedIds = await resolver.resolveSequence(inputIds);

      // 4. Decode
      const code = atomizer.decodeSequence(resolvedIds, system);
      console.log("[DEBUG E2E] Synthesized Code:\n", code);

      // 5. Verify Coherence
      assert(code !== "unknown", "Resolver failed to synthesize code");

      const normalizedCode = code.replace(/\s+/g, "");
      const expected = "functioncalculate(x:number,y:number){returnx+y}";

      console.log("[DEBUG E2E] Normalized Code:", normalizedCode);

      assert(
        normalizedCode === expected,
        `Coherence Failure!\nGot:      ${normalizedCode}\nExpected: ${expected}`
      );
    });

    await TestHarness.disposeEnvironment(env);
  });
}

export { executeE2ETest };

if (require.main === module) {
  executeE2ETest()
    .catch(e => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => process.exit(0));
}
