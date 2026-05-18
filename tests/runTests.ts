import logger from "@src/utils/SpectralLogger";
import { program } from "commander";
import { runLogicTest as executeAristotelianSuite } from "./aristotelian_quantum.test";
import { executeAtomizerRoundTripSuite } from "./atomizer_roundtrip.test";
import { executeCodeSynthesisSuite } from "./code_synthesis.test";
import { executeLogicSuite } from "./dod_resolution_matrix.test";
import { executeSuite as executeSystemSuite } from "./dod_system.test";
import { executeEnduranceSuite } from "./endurance.test";
import { executeGPUOffloadTest } from "./gpu_offload.test";
import { runGroundingTests } from "./grounding/propositional.test";
import { executeLiveInferenceSuite } from "./live_inference.test";
import { runMapperReviewTest } from "./mapper_review.test";
import { executeE2ETest } from "./pcs_e2e.test";
import { executePersistenceSuite } from "./persistence.test";
import { runRigorousTests as executeRigorousLogicSuite } from "./rigorous_logic.test";
import { executeSemanticSuite } from "./semantic_atomizer.test";
import { executeComplexSemanticSuite } from "./semantic_reasoning_perf.test";
import { executeSignalManagerSuite } from "./signal_and_manager.test";
import { runSignatureConsistencyTests } from "./signature_consistency.test";
import { runAstSeederTests } from "./ast_seeder.test";
import { runProactivePathTests } from "./proactive_paths.test";
import { executeStressSuite } from "./stress_and_edge_cases.test";
import { executeUMAPSuite } from "./umap_loader.test";
import { executeUnfolderSuite } from "./unfolder.test";
import { TestHarness } from "./utils/harness";
import { runRigorousTraps as executeLogicTrapsSuite } from "./verbose_logic_traps.test";

const SUITE_TIMEOUT_MS = 120_000;

/** Runs a suite with a hard timeout so one hanging test cannot block CI. */
async function runWithTimeout(
  name: string,
  fn: () => Promise<void>
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Suite "${name}" timed out after ${SUITE_TIMEOUT_MS / 1000}s`
          )
        ),
      SUITE_TIMEOUT_MS
    );
  });
  try {
    await Promise.race([fn(), timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function run() {
  let exitCode = 0;
  program
    .option("-s, --shared", "Use shared system environment across tests", false)
    .option(
      "--verbose",
      "Emit W-matrix, resonance and sink-candidate dumps for grounding failures",
      false
    )
    .parse(process.argv);

  const options = program.opts();
  if (options.shared) {
    logger.log("SHARED ENVIRONMENT ENABLED");
    TestHarness.setSharedEnv(true);
  }

  logger.header("MODPAT PHYSICS-BASED LOGIC ENGINE - INTEGRATED TEST SUITE");

  try {
    await runWithTimeout("dod_system", executeSystemSuite);
    await runWithTimeout("umap_loader", executeUMAPSuite);
    await runWithTimeout("unfolder", executeUnfolderSuite);
    await runWithTimeout("persistence", executePersistenceSuite);
    await runWithTimeout("dod_resolution_matrix", executeLogicSuite);
    await runWithTimeout("semantic_atomizer", executeSemanticSuite);
    await runWithTimeout("signal_and_manager", executeSignalManagerSuite);
    await runWithTimeout("mapper_review", runMapperReviewTest);
    await runWithTimeout("pcs_e2e", executeE2ETest);
    await runWithTimeout(
      "semantic_reasoning_perf",
      executeComplexSemanticSuite
    );
    await runWithTimeout("stress_and_edge_cases", executeStressSuite);
    await runWithTimeout("gpu_offload", executeGPUOffloadTest);
    await runWithTimeout("live_inference", executeLiveInferenceSuite);
    await runWithTimeout("aristotelian_quantum", executeAristotelianSuite);
    await runWithTimeout("rigorous_logic", executeRigorousLogicSuite);
    await runWithTimeout("verbose_logic_traps", executeLogicTrapsSuite);
    await runWithTimeout("code_synthesis", executeCodeSynthesisSuite);
    await runWithTimeout("grounding", async () => {
      await runGroundingTests();
    });
    await runWithTimeout("atomizer_roundtrip", executeAtomizerRoundTripSuite);
    await runWithTimeout("signature_consistency", runSignatureConsistencyTests);
    await runWithTimeout("ast_seeder", runAstSeederTests);
    await runWithTimeout("proactive_paths", runProactivePathTests);
    await runWithTimeout("endurance", executeEnduranceSuite);

    logger.log("\nALL SUITES COMPLETED SUCCESSFULLY.");
  } catch (error) {
    logger.error("\nTEST SUITE FAILED", error);
    exitCode = 1;
  } finally {
    await TestHarness.disposeAll();
    process.exit(exitCode);
  }
}

run();
