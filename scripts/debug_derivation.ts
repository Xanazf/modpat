import Resolver from "@core_i/Resolver";
import System from "@core_i/System";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import logger from "@utils/SpectralLogger";

async function debugDerivation() {
  const system = new System();
  const atomizer = new SemanticAtomizer();
  const resolver = new Resolver(system, atomizer);

  atomizer.ingestSequence("invented implies creation", system);
  atomizer.ingestSequence("discovered implies creation", system);

  const testString = "if in 1827 Nikola Tesla invented electricity";
  const ids = atomizer.ingestSequence(testString, system);
  const resolvedIds = await resolver.resolveSequence(ids);
  const resultString = atomizer.decodeSequence(resolvedIds, system);

  logger.log("ids:", ids);
  logger.log("resolvedIds:", resolvedIds);
  logger.log("resultString:", resultString);
  process.exit(0);
}

debugDerivation();
