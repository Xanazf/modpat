import logger from "@src/utils/SpectralLogger";
import { program } from "commander";
import { runLogicTest as executeAristotelianSuite } from "./aristotelian_quantum.test";
import { executeLogicSuite } from "./dod_resolution_matrix.test";
import { executeSuite as executeSystemSuite } from "./dod_system.test";
import { executeGPUOffloadTest } from "./gpu_offload.test";
import { executeLiveInferenceSuite } from "./live_inference.test";
import { runMapperReviewTest } from "./mapper_review.test";
import { executePersistenceSuite } from "./persistence.test";
import { runRigorousTests as executeRigorousLogicSuite } from "./rigorous_logic.test";
import { executeSemanticSuite } from "./semantic_atomizer.test";
import { executeComplexSemanticSuite } from "./semantic_reasoning_perf.test";
import { executeSignalManagerSuite } from "./signal_and_manager.test";
import { executeStressSuite } from "./stress_and_edge_cases.test";
import { executeUMAPSuite } from "./umap_loader.test";
import { TestHarness } from "./utils/harness";
import { runRigorousTraps as executeLogicTrapsSuite } from "./verbose_logic_traps.test";

async function run() {
  program
    .option("-s, --shared", "Use shared system environment across tests", false)
    .parse(process.argv);

  const options = program.opts();
  if (options.shared) {
    logger.log("SHARED ENVIRONMENT ENABLED");
    TestHarness.setSharedEnv(true);
  }

  logger.header("MODPAT PHYSICS-BASED LOGIC ENGINE - INTEGRATED TEST SUITE");

  try {
    await executeSystemSuite();
    await executeUMAPSuite();
    await executePersistenceSuite();
    await executeLogicSuite();
    await executeSemanticSuite();
    await executeSignalManagerSuite();
    await runMapperReviewTest();
    await executeComplexSemanticSuite();
    await executeStressSuite();
    await executeGPUOffloadTest();
    await executeLiveInferenceSuite();

    // Integrated previously orphaned tests
    await executeAristotelianSuite();
    await executeRigorousLogicSuite();
    await executeLogicTrapsSuite();

    logger.log("\nALL SUITES COMPLETED SUCCESSFULLY.");
  } catch (error) {
    logger.error("\nTEST SUITE FAILED", error);
    process.exit(1);
  } finally {
    await TestHarness.disposeAll();
    process.exit(0);
  }
}

run();
