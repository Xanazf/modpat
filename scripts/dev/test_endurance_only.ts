import logger from "@src/utils/SpectralLogger";
import { executeEnduranceSuite } from "@root/tests/endurance.test";
import { TestHarness } from "@root/tests/utils/harness";

async function main() {
  logger.header("RUNNING ENDURANCE TEST ONLY");
  try {
    await executeEnduranceSuite();
    logger.log("\nENDURANCE TEST COMPLETED.");
  } catch (error) {
    logger.error("\nENDURANCE TEST FAILED", error);
    process.exit(1);
  } finally {
    await TestHarness.disposeAll();
    process.exit(0);
  }
}

main();
