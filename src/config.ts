const DOPAT_CONFIG = {
  STRIDE_COMPLEX: 2,
  MAX_PRECEPTS: 100_000,
  INFLUENCE_ZONES: 16,
  DELTA: 16.667,
  EPSILON: Number.MIN_VALUE * 10,
  MAXILON: Number.MAX_SAFE_INTEGER * 10e-3,
  BLACKBODY_LIMIT: 1e10,
  RING_BUFFER_SIZE: 1024,
  DECAY_RATE: 0.95,
  USE_GPU: true,
};

// TODO: debug bindings
const BRAIN_CONFIG = {
  DEBUG: true,
  DEDUCE: {
    START_ANCHOR: 4.0,
    END_ANCHOR: 0.5,
    INHIBITION: 1.0,
    LEARNING_RATE: 0.1,
  },
  RECURRENCE: {
    UPDATE_GATE: 0.6,
    HIDDEN_DECAY: 0.95,
  },
  EMBEDDING: {
    RIGHT_DIRECTIONAL_FLAG_INDEX: 92,
    DIRECTIONAL_FLAG_INDEX: 93,
    POLARITY_INDEX: 94,
    OPERATOR_FLAG_INDEX: 95,
    SECONDARY_RIGHT_DIRECTIONAL_FLAG_INDEX: 188,
    SECONDARY_DIRECTIONAL_FLAG_INDEX: 189,
    SECONDARY_OPERATOR_FLAG_INDEX: 191,
    STABILITY_THRESHOLD: 0.95,
  },
  DOD_EMBEDDING: {
    LOGIC_OFFSET: 0,
    SEMANTIC_OFFSET: 96,
    BASE_FREQUENCY: 1.0,
    GLOVE_PATH:
      "data/wiki_giga_2024_50_MFT20_vectors_seed_123_alpha_0.75_eta_0.075_combined.txt",
    UMAP_DICT_PATH: "data/dictionary.txt",
    UMAP_BINARY_PATH: "data/umap_data.bin",
  },
};

enum RESOLVER_ACTIONS {
  adapt = "ADAPT",
  reject = "REJECT",
  learn = "LEARN",
  stabilize = "STABILIZE",
}

const LOGIC_PATTERNS = [
  // IF
  /\bif\b/i,
  /\bthen\b/i,
  /\belse\b/i,
  // FOR
  /\ball\b/i,
  /\bfor\b\s+\ball\b/i,
  // IS
  /\bis\b/i,
  /\bare\b/i,
  /\bexists\b/i,
  // IMPLIES
  /\bimplies\b/i,
  /=>/,
  // THEREFORE
  /\|-/,
  // AND
  /&&/,
  // OR
  /\|\|/,
];

const FULL_DIRECTIONAL_PATTERNS = [
  /\bimplies\b/i,
  /=>/,
  /\bthen\b/i,
  /\bis\b/i,
  /\bare\b/i,
];

const RIGHT_DIRECTIONAL_PATTERNS = [/\|-/, /\btherefore\b/i];

const ATOMIC_PATTERNS = [
  // lower-case word
  /\b[a-z]\b/i,
];

export {
  ATOMIC_PATTERNS,
  BRAIN_CONFIG,
  DOPAT_CONFIG,
  FULL_DIRECTIONAL_PATTERNS,
  LOGIC_PATTERNS,
  RESOLVER_ACTIONS,
  RIGHT_DIRECTIONAL_PATTERNS,
};
