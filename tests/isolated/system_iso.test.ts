import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import { describe, it } from "../utils/harness";
import System, {
  LogicOperations,
  TargetBuffer,
  classifyOperator,
} from "./subjects/System_iso";
import type OG_System from "@core_i/System";
import LogicAtomizer from "@atomics/LogicAtomizer";

export async function runIsolatedSystemTest() {
  const sys = new System() as unknown as OG_System;
  const atomizer = new LogicAtomizer();
  const test_str1 = "all human are mortal";
  const test_str2 = "socrates is human";
  const mock_idx_map1 = test_str1.split(" ");
  const mock_idx_map2 = test_str2.split(" ");
  const mock_idx_map = [...mock_idx_map1, ...mock_idx_map2];

  await describe("Isolated System Test", async () => {
    await it("Case 1: Basic storage and retrieval", async () => {
      logger.log(`System length before: ${sys.length}`);
      logger.log("");
      const ids1 = atomizer.ingestSequence(test_str1, sys);
      const ids2 = atomizer.ingestSequence(test_str2, sys);
      const ids = [...ids1, ...ids2];
      logger.log(`Storage 1: [${ids1}]`);
      logger.log(`Storage 2: [${ids2}]`);
      for (let i = 0; i < ids.length; i++) {
        const e = ids[i];
        logger.section(
          "Element",
          "---",
          `--- Element@${e}: "${mock_idx_map[i]}" ---`
        );
        logger.log(`Mass,X@[${e}]: ${sys.mass[e]},${sys.posX[e]}`);
        logger.log(`Scope,Y@[${e}]: ${sys.scope[e]},${sys.posY[e]}`);
        logger.log(`Depth,Z@[${e}]: ${sys.depth[e]},${sys.posZ[e]}`);
        logger.log(`Time,W@[${e}]: ${sys.time[e]},${sys.posW[e]}`);
      }
      logger.log(`===`);
      logger.log("");
      logger.log(`System length after: ${sys.length}`);
      console.log(
        "System Ring Buffer:\n",
        "[from]:[to] | [result] | [affected]"
      );
      console.log(JSON.stringify(sys.updateRing.toArray(), null, "\n"));
      console.log("System Last Change: ", sys.updateRing.getLast());

      const result1 = atomizer.decodeSequence(ids1, sys).toLowerCase();
      const result2 = atomizer.decodeSequence(ids2, sys).toLowerCase();

      logger.log("");
      logger.logic(`Retrieval 1`, sys, ids1, atomizer);
      logger.logic(`Retrieval 2`, sys, ids2, atomizer);
      const assertion =
        result1.includes("mortal") && result2.includes("socrates");

      assert.ok(
        assertion,
        `\nStorage/Retrieval unsuccessful, got: '${result1}', '${result2}'`
      );
    });
  });
}

runIsolatedSystemTest();
