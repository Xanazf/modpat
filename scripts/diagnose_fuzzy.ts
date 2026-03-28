import Resolver from "@core_i/Resolver";
import System from "@core_i/System";
import SemanticAtomizer from "@atomics/SemanticAtomizer";
import logger from "@utils/SpectralLogger";

async function diagnose() {
  const system = new System();
  const atomizer = new SemanticAtomizer();
  await atomizer.init();
  const resolver = new Resolver(system, atomizer);

  const tokens = ["mars", "red", "planet", "fire"];
  logger.header("UMAP Coordinate Diagnostics");

  for (const t of tokens) {
    const id = atomizer.ingestSequence(t, system)[0];
    const x = system.posX[id];
    const y = system.posY[id];
    const z = system.entropy[id];
    const w = system.time[id];
    logger.log(
      `${t.padEnd(10)}: X=${x.toFixed(4)}, Y=${y.toFixed(4)}, Z=${z.toFixed(4)}, W=${w.toFixed(4)}`
    );
  }

  const marsId = atomizer.ingestSequence("mars", system)[0];
  const redId = atomizer.ingestSequence("red", system)[0];
  const planetId = atomizer.ingestSequence("planet", system)[0];

  const dist = (id1: number, id2: number) => {
    const dx = system.posX[id1] - system.posX[id2];
    const dy = system.posY[id1] - system.posY[id2];
    const dz = system.entropy[id1] - system.entropy[id2];
    const dw = system.time[id1] - system.time[id2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);
  };

  logger.log(`\nDist(Mars, Red):    ${dist(marsId, redId).toFixed(4)}`);
  logger.log(`Dist(Mars, Planet): ${dist(marsId, planetId).toFixed(4)}`);
  logger.log(`Dist(Red, Planet):  ${dist(redId, planetId).toFixed(4)}`);

  // Calculate centroid of "the red planet"
  const centerX = (system.posX[redId] + system.posX[planetId]) / 2;
  const centerY = (system.posY[redId] + system.posY[planetId]) / 2;
  const centerZ = (system.entropy[redId] + system.entropy[planetId]) / 2;
  const centerW = (system.time[redId] + system.time[planetId]) / 2;

  const dx = system.posX[marsId] - centerX;
  const dy = system.posY[marsId] - centerY;
  const dz = system.entropy[marsId] - centerZ;
  const dw = system.time[marsId] - centerW;
  const distToCentroid = Math.sqrt(dx * dx + dy * dy + dz * dz + dw * dw);

  logger.log(`Dist(Mars, Red-Planet Centroid): ${distToCentroid.toFixed(4)}`);

  // Quantum Interference check
  logger.header("Quantum Interference Diagnostics");
  const input = "point alpha leads to point beta";
  const seqIds = atomizer.ingestSequence(input, system);
  logger.log(`Input: "${input}"`);

  for (const id of seqIds) {
    const decoded = atomizer.decodeSequence(new Uint32Array([id]), system);
    const cls = system.operatorClass[id];
    logger.log(`  ID ${id}: "${decoded}" (Class: ${cls})`);
  }

  const findId = (token: string) => {
    for (const id of seqIds) {
      if (
        atomizer
          .decodeSequence(new Uint32Array([id]), system)
          .toLowerCase()
          .includes(token)
      )
        return id;
    }
    return -1;
  };

  const alphaId = findId("alpha");
  const betaId = findId("beta");

  logger.log(`Found alphaId: ${alphaId}, betaId: ${betaId}`);

  if (alphaId !== -1 && betaId !== -1) {
    const distIds = atomizer.ingestSequence("massive distractor", system);
    const distractorId = distIds[distIds.length - 1];

    system.posX[distractorId] = system.posX[alphaId] + 1.0;
    system.posY[distractorId] = system.posY[alphaId] + 1.0;
    system.mass[distractorId] = system.c ** 2 * 1000000.0;
    system.entropy[distractorId] = 0.0;

    logger.log(
      `Alpha [${alphaId}]: X=${system.posX[alphaId].toFixed(2)}, Y=${system.posY[alphaId].toFixed(2)}`
    );
    logger.log(
      `Distractor [${distractorId}]: X=${system.posX[distractorId].toFixed(2)}, Y=${system.posY[distractorId].toFixed(2)}`
    );

    const dx2 = system.posX[alphaId] - system.posX[distractorId];
    const dy2 = system.posY[alphaId] - system.posY[distractorId];
    const trapDistSq = dx2 * dx2 + dy2 * dy2;
    logger.log(
      `Distance Alpha to Distractor: ${Math.sqrt(trapDistSq).toFixed(4)}`
    );
  }
  process.exit(0);
}

diagnose();
