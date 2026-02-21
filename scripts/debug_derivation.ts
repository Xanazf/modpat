import Resolver from "@core/integral/Resolver";
import System from "@core/integral/System";
import SemanticAtomizer from "@core/structural/SemanticAtomizer";
import logger from "@src/utils/SpectralLogger";

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
