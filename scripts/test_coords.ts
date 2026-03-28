import { BRAIN_CONFIG } from "@config";
import { UMAPLoader } from "@core_s/UMAPLoader";

async function test() {
  const loader = new UMAPLoader(
    BRAIN_CONFIG.DOD_EMBEDDING.UMAP_BINARY_PATH,
    BRAIN_CONFIG.DOD_EMBEDDING.UMAP_DICT_PATH
  );

  const words = ["fire", "red", "planet", "the", "mars"];
  for (const word of words) {
    console.log(`${word}:`, loader.getScope(word).toFixed(2));
  }

  const subX =
    (loader.getScope("the") +
      loader.getScope("red") +
      loader.getScope("planet")) /
    3;
  console.log("Centroid (the red planet):", subX.toFixed(2));
}

test();
