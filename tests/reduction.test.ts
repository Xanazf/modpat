/**
 * Phase 3 - reduction as traversal.
 *
 * Numbers are grounded on the W number line (posW = value × 0.1). An additive
 * reduction composes the operands' positions: "3 + 4" traverses from 3's
 * position by 4's position and lands on 7. The geometry computes - and the
 * reduct is a DISTINCT, DOWNSTREAM node (not an echo of the operands), which is
 * the property Phase 2's gate needs to tell a real conclusion from a restatement.
 */

import assert from "node:assert";
import LogicAtomizer from "@atomics/LogicAtomizer";
import System from "@core_i/System";
import {
  NUMBER_LINE_SCALE,
  parseIsFacts,
  reduceAdditive,
  reduceEntailment,
} from "@skill_cogi/Reduction";
import logger from "@utils/SpectralLogger";
import { describe, it } from "./utils/harness";

export async function runReductionTests(): Promise<void> {
  await describe("PHASE 3 - REDUCTION AS TRAVERSAL", async () => {
    const system = new System();
    const atomizer = new LogicAtomizer();
    await atomizer.init();

    // Ground numerals 0..10 on the W number line, the way a number-grounded
    // atomizer would (posW = n × 0.1; eternal, so decay never drifts them).
    const numId = new Map<number, number>();
    for (let n = 0; n <= 10; n++) {
      const scope = atomizer.getSymbolScope(String(n), false);
      const id = system.createLocation(system.c, scope);
      system.posW[id] = n * NUMBER_LINE_SCALE;
      system.decayRate[id] = 0;
      system.update(id);
      numId.set(n, id);
    }

    const decode = (id: number) =>
      atomizer.decodeSequence(new Uint32Array([id]), system).trim();

    await it("3 + 4 reduces to 7 by number-line composition", async () => {
      const r = reduceAdditive(
        "+",
        numId.get(3)!,
        numId.get(4)!,
        system,
        atomizer
      );
      assert.ok(r, "a reduction should occur");
      assert.strictEqual(r!.value, 7);
      assert.strictEqual(decode(r!.resultId), "7");
      logger.log(
        `  3 + 4 -> "${decode(r!.resultId)}" (posW=${r!.reductW.toFixed(2)})`
      );
    });

    await it("9 - 2 reduces to 7", async () => {
      const r = reduceAdditive(
        "-",
        numId.get(9)!,
        numId.get(2)!,
        system,
        atomizer
      );
      assert.ok(r);
      assert.strictEqual(r!.value, 7);
    });

    await it("addition is commutative (4 + 3 == 3 + 4)", async () => {
      const a = reduceAdditive(
        "+",
        numId.get(4)!,
        numId.get(3)!,
        system,
        atomizer
      )!;
      const b = reduceAdditive(
        "+",
        numId.get(3)!,
        numId.get(4)!,
        system,
        atomizer
      )!;
      assert.strictEqual(a.value, b.value);
      assert.strictEqual(a.value, 7);
    });

    await it("the reduct is a distinct, downstream node (not an echo)", async () => {
      const aId = numId.get(3)!;
      const bId = numId.get(4)!;
      const r = reduceAdditive("+", aId, bId, system, atomizer)!;
      assert.notStrictEqual(r.resultId, aId, "reduct must not be operand A");
      assert.notStrictEqual(r.resultId, bId, "reduct must not be operand B");
      assert.ok(
        r.reductionDistance > 0,
        "a genuine reduction moves along the W axis (anti-echo)"
      );
      assert.notStrictEqual(
        system.posW[r.resultId],
        system.posW[aId],
        "reduct sits at a different number-line position than its operands"
      );
      logger.log(
        `  reduct id=${r.resultId} distinct from {${aId},${bId}}, ` +
          `reductionDistance=${r.reductionDistance.toFixed(2)}`
      );
    });

    // -- Universal instantiation (the calibration's syllogism fix) -----------

    await it("instantiation: tweety is a bird + all birds are animals => animal", async () => {
      const facts = parseIsFacts("all birds are animals. tweety is a bird.");
      const r = reduceEntailment("tweety", facts);
      logger.log(
        `  tweety -> [${r.conclusions.join(", ")}] (animal @ hop ${r.hops.get("animal")})`
      );
      assert.ok(
        r.conclusions.includes("animal"),
        "tweety should reduce to animal, not echo the premises"
      );
      assert.strictEqual(
        r.hops.get("animal"),
        2,
        "animal is reached by applying the rule (2 hops)"
      );
      assert.ok(r.derived.includes("animal"), "animal is a genuine derivation");
    });

    await it("transitive rule chaining: birds -> animals -> organisms", async () => {
      const facts = parseIsFacts(
        "all birds are animals. all animals are organisms. tweety is a bird."
      );
      const r = reduceEntailment("tweety", facts);
      assert.ok(r.conclusions.includes("animal"));
      assert.ok(
        r.conclusions.includes("organism"),
        "transitive closure should reach organism"
      );
    });

    await it("negation blocks the edge: felix is a cat, cats are not fish => not fish", async () => {
      const facts = parseIsFacts("cats are not fish. felix is a cat.");
      const r = reduceEntailment("felix", facts);
      assert.ok(r.conclusions.includes("cat"), "felix is a cat");
      assert.ok(
        !r.conclusions.includes("fish"),
        "felix must NOT be concluded a fish"
      );
    });

    await it("no rule => nothing derived (abstain-worthy, not an echo)", async () => {
      const facts = parseIsFacts("tweety is a bird.");
      const r = reduceEntailment("tweety", facts);
      assert.ok(r.conclusions.includes("bird"));
      assert.strictEqual(
        r.derived.length,
        0,
        "no rule applied, so nothing is derived"
      );
    });
  });
}
