const DOPAT_CONFIG = {
  STRIDE_COMPLEX: 2,
  MAX_PRECEPTS: 1_000_000,
  INFLUENCE_ZONES: 16,
  DELTA: 16.667,
  EPSILON: Number.MIN_VALUE * 10,
  MAXILON: Number.MAX_SAFE_INTEGER * 10e-3,
  BLACKBODY_LIMIT: 1e10,
  RING_BUFFER_SIZE: 1024,
  /** Capacity of the scope-sequence index ring used for O(ring) forward-match lookups. */
  SEQUENCE_INDEX_SIZE: 4096,
  DECAY_RATE: 0.95,
  USE_GPU: true,
  DRIFT_THRESHOLD: 100.0,
  PHYSICS: {
    INFLUENCE_RADIUS: 400.0,
    INFLUENCE_FALLOFF: 40.0,
    PENALTY_RADIUS: 100.0,
    PENALTY_FALLOFF: 20.0,
    GRADIENT_STEP: 0.01,
    VOID_POTENTIAL_THRESHOLD: 0.8,
    TRAP_MASS_THRESHOLD: 5000.0,
    TRAP_ENTROPY_THRESHOLD: 0.1,
    TRAP_DISTANCE_THRESHOLD: 25.0,
    /** Additive influence boost for Body-slot precepts during path relaxation. */
    BODY_SLOT_ATTRACTION: 80.0,
    /** Additive influence boost for Condition-slot precepts during path relaxation. */
    COND_SLOT_ATTRACTION: 60.0,
  },

  resolver: {
    /** Scope equality tolerance; increase if floating-point noise causes false negatives. */
    SCOPE_EPSILON: 1e-6,
    /** Propagation damping factor. */
    PROPAGATION_ALPHA: 0.85,
    /** Number of propagation iterations for stability. */
    PROPAGATION_ITERS: 10,
    /** Weight for constructive interference. */
    W_CONSTRUCTIVE: 1.0,
    /** Weight for gravitational lensing. */
    W_LENSING: 0.7,
    /** Weight for destructive interference. */
    W_DESTRUCTIVE: -1.0,
  },

  mapper: {
    /** The step size for gradient descent updates during path relaxation. */
    GRADIENT_STEP: 0.01,
    /** Squared orbit radius for clustering. */
    ORBIT_RADIUS_SQ: 0.5,
    /** Mass penalty for detecting logic traps. */
    TRAP_PENALTY: 1_000,
    /** Maximum number of gaps to fill during path resolution. */
    PATH_GAP_FILL_MAX: 5,
  },

  memory: {
    /**
     * Dedup threshold: patterns whose anchor distance exceeds this are stored as separate
     * entries (high recall). Query threshold: a candidate is a hit only if its squared
     * 4D distance is below this (tight recall to avoid false-positive cache hits).
     * Asymmetry is intentional: prefer storing duplicates over losing proofs.
     */
    VAULT_DEDUP_THRESHOLD: 0.5,
    VAULT_QUERY_THRESHOLD: 0.1,
    /** Grid cell size for the DuckDB covering index on (grid_x, grid_y, grid_z, grid_w).
     *  R = ceil(VAULT_QUERY_THRESHOLD / GRID_CELL) cells are searched per axis. */
    GRID_CELL: 0.05,
    USAGE_WEIGHT: 3,
    FEEDBACK_BOOST: 1.2,
    /** Multiplicative decay applied to usage_count during cull cycles (0–1). */
    USAGE_DECAY_RATE: 0.95,
  },

  structural: {
    /** The default void X coordinate representing a far position out of influence. */
    VOID_POS_X: 50_000,
    /** Layer bucket size for indexing. */
    LAYER_BUCKET_SIZE: 10,
    /** Whether to skip the first intra layer checking. */
    INTRA_LAYER_SKIP_FIRST: true,
    /** Consolidation iterations per tick [lo, hi]. */
    CONSOLIDATION_ITERS_PER_TICK: [10, 50] as [number, number],
    /** Abort timeout for Unfolder external fetches (Wikipedia, Context7). */
    UNFOLDER_FETCH_TIMEOUT_MS: 5_000,
    /** Maximum entries in the pendingDreams queue before shedding new cycles. */
    PENDING_DREAMS_MAX: 5,
    /** Half-width of the random posX jitter applied to dreamt precepts. */
    DREAM_POS_X_JITTER: 10,
    /** Maximum entries in the DeltaQueue before shedding oldest deltas. */
    DELTA_QUEUE_MAX: 10_000,
  },

  atomizer: {
    /** Multiplier applied per triplet-inheritance nesting level ("the X" → 4×). */
    INHERITANCE_BASE_FACTOR: 4.0,
    /** Hard cap on accumulated inheritance multiplier (prevents runaway mass). */
    MAX_INHERITANCE_MASS_FACTOR: 16.0,
  },

  observability: {
    /** Emit a JSONL metrics snapshot every N ManifoldManager ticks. */
    METRICS_EMIT_INTERVAL_TICKS: 100,
    /** Path for the append-only JSONL metrics log. */
    METRICS_LOG_PATH: "./logs/modpat_metrics.jsonl",
  },
};

export function validateConfig(): void {
  const { resolver, mapper, memory, structural } = DOPAT_CONFIG;

  if (resolver.SCOPE_EPSILON <= 0) throw new Error("SCOPE_EPSILON must be > 0");

  if (resolver.PROPAGATION_ALPHA <= 0 || resolver.PROPAGATION_ALPHA >= 1)
    throw new Error("PROPAGATION_ALPHA must be in (0, 1)");

  if (mapper.GRADIENT_STEP <= 0) throw new Error("GRADIENT_STEP must be > 0");

  if (memory.VAULT_DEDUP_THRESHOLD < memory.VAULT_QUERY_THRESHOLD)
    throw new Error("VAULT_DEDUP_THRESHOLD must be >= VAULT_QUERY_THRESHOLD");

  if (structural.VOID_POS_X <= DOPAT_CONFIG.PHYSICS.INFLUENCE_RADIUS)
    throw new Error("VOID_POS_X must be well outside INFLUENCE_RADIUS");

  const [lo, hi] = structural.CONSOLIDATION_ITERS_PER_TICK;
  if (lo < 1 || hi < lo)
    throw new Error("CONSOLIDATION_ITERS_PER_TICK must satisfy 1 <= lo <= hi");
}

// TODO: debug bindings
const SYSTEM_CONFIG = {
  DEBUG: false,
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
    SEMANTIC_OFFSET: 1024,
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

export const SYNTAX_ATTRACTORS = {
  KEYWORDS: new Set([
    "function",
    "const",
    "let",
    "return",
    "if",
    "else",
    "import",
    "export",
    "class",
    "interface",
    "type",
    "await",
    "async",
  ]),
  STRUCTURES: new Set([
    "{",
    "}",
    "(",
    ")",
    "[",
    "]",
    "=>",
    ":",
    ";",
    ".",
    "+",
    "-",
    "*",
    "/",
    "=",
    ",",
    "<",
    ">",
  ]),
};

export {
  ATOMIC_PATTERNS,
  SYSTEM_CONFIG,
  DOPAT_CONFIG,
  FULL_DIRECTIONAL_PATTERNS,
  LOGIC_PATTERNS,
  RESOLVER_ACTIONS,
  RIGHT_DIRECTIONAL_PATTERNS,
};
