const DOPAT_CONFIG = {
  /** Seed for the seeded PRNG (seededRandom.ts). 0 = deterministic default. */
  SEED: 0,
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
  /** PHYSICS is uppercase by convention: these are invariant physical laws, not a component config. All other sub-namespaces (resolver, mapper, structural…) configure runtime components and use lowercase. */
  PHYSICS: {
    /**
     * Normalization constant for derived physical properties (density, entropyRate, intensity).
     * Previously this was the atom's scope value, which happened to be ~1024 for most
     * atoms under the old SEMANTIC_OFFSET scheme.  Now that scope is a pure identity tag
     * (small integer), this constant makes the physics self-consistent without scope coupling.
     */
    PRECEPT_SCALE: 1024.0,
    /**
     * Initial posW (temporal freshness) assigned to a precept when it is first ingested
     * or when its concept is accessed via a vault hit.  Always 1.0 (maximum freshness).
     */
    AGE_FRESHNESS: 1.0,
    /**
     * Per-second exponential decay rate for posW freshness.
     * freshness(t) = freshness(0) × e^(-AGE_DECAY_RATE × t_seconds)
     * At 0.05 → half-life ≈ 14 s.  Concepts stay warm for roughly a minute
     * before their energy bonus in the Resolver becomes negligible.
     */
    AGE_DECAY_RATE: 0.05,
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
    /**
     * Hard upper bound for φ (local semantic density sum) to prevent numerical
     * blow-up in the conformal factor e^{-2φ} when many atoms overlap.
     * P2 safety gate: increments Mapper.phiClippedCount when triggered.
     */
    PHI_MAX: 50.0,
    /**
     * When true, the conformal metric correction e^{-2φ} is applied to path
     * relaxation.  Set false to run plain geodesic (no conformal weighting) for
     * A2 A/B comparisons.
     */
    CONFORMAL_ENABLED: true,
    /**
     * When true, getMetricForce includes the inner derivative of φ w.r.t.
     * position (full gradient through the conformal factor).  False uses the
     * simplified approximation that treats φ as spatially constant - valid for
     * φ ≪ 1 and ~4× cheaper.  A1 design decision: keep simplified, expose
     * full version behind this flag for A/B testing only.
     */
    A_B_FULL_GRADIENT: false,
    /**
     * Decay constant for the smooth temporal suppression factor:
     *   temporal_weight = exp(-PHI_TEMPORAL_DECAY × max(0, pw_probe - pw_atom))
     * Replaces the previous hard 0.01 cutoff.  Composes multiplicatively with
     * the conformal e^{-2φ} factor.  PHI_TEMPORAL_DECAY = 3.0 gives:
     *   Δw = 0   → weight 1.0   (no suppression)
     *   Δw = 0.5 → weight ≈ 0.22
     *   Δw = 1.0 → weight ≈ 0.05
     */
    PHI_TEMPORAL_DECAY: 3.0,
    /**
     * C3 - Discrete Ricci flow: hard cap on the curvature value fed into the
     * Ricci tick update.  Clamps the *input* R, not the resulting density delta,
     * preventing runaway φ-nudges in pathologically curved regions.
     */
    RICCI_BLOWUP_THRESHOLD: 10.0,
    /**
     * C3 - Per-tick learning rate for the Ricci flow density nudge.
     * density[i] -= RICCI_LR × clamp(R_i, ±RICCI_BLOWUP_THRESHOLD)
     * Kept deliberately small so topology changes remain gradual.
     */
    RICCI_LR: 0.001,
    /**
     * C3 - Ricci flow maintenance tick frequency (every N ManifoldLifecycle ticks).
     * Runs at the same cadence as the topology tick by default.
     */
    RICCI_TICK_INTERVAL: 100,
    /**
     * C4 - Per-update learning rate for the learned Christoffel correction ΔΓᵢⱼᵏ.
     * Applied on vault hits (positive) and traps / contradictions (negative).
     */
    CHRISTOFFEL_LR: 0.001,
    /**
     * C4 - Per-learnCycle decay toward zero for ΔΓᵢⱼᵏ.
     * Regularizes the learned correction so the prescribed conformal metric
     * dominates until sufficient supervised signal accrues.
     */
    CHRISTOFFEL_REGULARIZATION: 0.01,
    /**
     * D1 - Singularity detection threshold: |∇φ|² / (1 + φ²) > this value
     * marks an atom as a singularity candidate.  Regions above this threshold
     * have a rank-deficient local geometry (many concepts colliding).
     */
    SINGULARITY_THRESHOLD: 0.1,
    /**
     * D1 - How often (in ManifoldLifecycle ticks) to run the singularity scan.
     * Less frequent than Ricci/topology ticks - remediation is disruptive.
     */
    SINGULARITY_TICK_INTERVAL: 500,
    /**
     * D1 - Displacement radius used when splitting a singularity atom into two.
     * The original atom and its sibling are nudged apart by fractions of this value
     * along the XY plane and the W (temporal) axis.
     */
    SINGULARITY_SPLIT_RADIUS: 5.0,
    /**
     * F4 - Blend factor for applying saved session φ to newly created atoms.
     * At createLocation() time: mass[id] = max(fresh_mass, PHI_SESSION_BLEND × saved_mass).
     * 1.0 = fully restore saved density; 0.5 = blend halfway; 0 = no restoration.
     * Kept < 1.0 by default so fresh ingestion can override stale session state.
     */
    PHI_SESSION_BLEND: 0.8,
    /**
     * TRAVELER step 1 - Master switch for pole ingestion.  When false, atoms land
     * at their embedding-derived coordinates (legacy behaviour); drift targets are
     * still recorded by Language._poleSettle() for the step-3 pipeline to consume.
     * Flip to true only after observeSettlingGradient() passes the step-3 A/B
     * validation criteria (Jaccard > 90%, cosine similarity > 95%).
     */
    POLE_INGESTION_ENABLED: false,
    /**
     * Phase 5 - coordinate-source migration. When true, a newly-ingested
     * language token derives its posX from its *referent* (an existing grounded
     * precept sharing the scope - a code symbol or a prior settled mention)
     * rather than from the GloVe→UMAP co-occurrence embedding, which is demoted
     * to a cold-start hint used only when no referent exists. This is the
     * structural-grounding channel reaching language: position comes from a
     * domain's own observable topology, not text statistics. Behaviour-preserving
     * for novel words (no referent ⇒ GloVe fallback), so safe to default on.
     */
    REFERENT_GROUNDING_ENABLED: true,
    /**
     * Phase 5 - cold-start grounding. When a token has no direct referent (the
     * first time a word is ever seen), derive its posX from the grounded
     * positions of its *co-occurring* CONTENT tokens in the same sequence (mean
     * referent posX, operators and stop-words excluded) rather than from GloVe.
     * This extends the structural channel to first-seen words - a novel term
     * lands in the neighbourhood of the grounded symbols it is uttered alongside.
     * Requires REFERENT_GROUNDING_ENABLED; falls back to GloVe otherwise.
     *
     * SELECTIVE TRIGGER (why it is safe to default ON). The co-occurrence basis is
     * restricted to STRUCTURALLY-grounded referents (`system.groundedPrecepts` -
     * code/logic/math symbols), never prior language mentions. A first pass with
     * the unrestricted trigger regressed the live semantic suites: bare sentence
     * co-occurrence with an earlier unrelated mention relocated a new word into
     * its region ("Tesla liked pie" after "Tesla invented electricity" pulled
     * `pie` toward `electricity`, so the void query stopped abstaining; "the grass
     * is" collapsed onto "the sky is"). Grounding only toward genuine grounded
     * referents fixes this at the root: in a language-only context (no grounded
     * precepts, as in those suites) cold-start is inert and falls back to GloVe,
     * so they are preserved exactly; it fires only where a real grounded symbol is
     * present (a function's callee, a code identifier), which is the intended case.
     */
    COLD_START_COOCCURRENCE_ENABLED: true,
    /**
     * Phase 4.5 - the survey loop, wired into learnCycle. When on, each
     * learnCycle ends with a territory-correction tick: every registered
     * GroundTruthChannel (self-supplied arithmetic, KB-supplied closed-world)
     * predicts via the geometry, checks against the territory, and re-places any
     * drifted precept in situ - the loop made continuous rather than a
     * diagnostic. Default OFF: it only acts where ground-truth channels are
     * registered (none by default), and a System with no grounded numerals /
     * KB is inert, so existing suites are untouched. The influence of each
     * ground-truth source is measured in scripts/dev/survey_loop_influence_bench.ts.
     */
    SURVEY_LOOP_ENABLED: true,
    /**
     * Roadmap step 9 - lexical antonym stance. When on, a content token that is a
     * WordNet lexical antonym of an already-placed concept ("cold" after "hot",
     * "false" after "true") is placed at that concept's X/Y/Z antipode at
     * ingestion - the same stance geometry syntactic negation ("not X") already
     * uses, extended to opposition that carries no "not" token. Opposed concepts
     * then sit on opposite manifold halves (distance >> neutral pairs) and the
     * WaveResolver reads "hot and cold" as a contradiction. The antonym source is
     * AntonymLexicon (atomizers/antonyms.json, from en-wordnet). It only fires when
     * BOTH members of a pair are present in the manifold, so a lone concept is
     * untouched; number-line W is preserved (opposition is spatial, not temporal).
     */
    LEXICAL_ANTONYM_STANCE_ENABLED: true,
    /**
     * TRAVELER step 1 - Spatial jitter radius (XYZ axes) applied when placing a
     * newly ingested atom at the manifold pole (0, 0, 0, 0).  Small enough that
     * co-ingested atoms are distinguishable by D1 singularity detection, large
     * enough to give each atom a unique starting position.
     */
    POLE_JITTER_XYZ: 0.05,
    /**
     * TRAVELER step 1 - Temporal jitter range for posW when placing a new atom
     * at the pole.  Gives the temporal suppression factor (PHI_TEMPORAL_DECAY)
     * a gradient to work with across simultaneous arrivals.
     */
    POLE_JITTER_W: 0.1,
    /**
     * TRAVELER step 1 - Maximum physics steps in the discrete settling simulation
     * that runs immediately after atoms land at the pole.  Each step integrates
     * the drift force from the embedding target toward the settled position.
     */
    SETTLE_MAX_TICKS: 20,
    /**
     * TRAVELER step 1 - Convergence criterion for the settling loop.  The loop
     * exits early when the maximum per-atom velocity (step size × residual
     * distance) drops below this threshold.
     */
    SETTLE_CONVERGENCE_THRESHOLD: 1e-4,
    /**
     * Directed-settling traversal (the validated replacement for relaxPath's
     * ill-conditioned boundary-value relaxation). A damped particle released at
     * the source falls through the un-muted attractor field toward a goal-biased
     * target: a = −∇V_field − λ(p − tgt) − γv. E = ½|v|² + V_field + ½λ|p−tgt|²
     * is a Lyapunov function, so settling is guaranteed for any λ. λ is NOT a
     * constant: it self-calibrates by escalate-until-arrival (the smallest bias
     * that reaches the target is the most faithful; more only beelines).
     */
    SETTLE_TRAVERSE_DT: 0.02,
    SETTLE_TRAVERSE_DAMPING: 3.0,
    SETTLE_TRAVERSE_MAX_STEPS: 2000,
    /** Initial bias force as a fraction of the source well-wall force. */
    SETTLE_TRAVERSE_LAMBDA0_FRACTION: 0.1,
    /** Cap on λ doublings before giving up the arrival search. */
    SETTLE_TRAVERSE_MAX_ESCALATIONS: 28,
    /**
     * Shadow mode: when true, `travel()` additionally runs directed settling
     * after relaxPath and logs the divergence between the two emitted paths
     * (`traverse.shadow_*` metrics). The returned path is UNCHANGED (relaxPath);
     * this only measures. Off by default.
     */
    SETTLING_TRAVERSE_SHADOW: false,
    /**
     * Primary traversal mechanism. When true (default), `travel()` produces the
     * geodesic by directed-settling (the Lyapunov-conditioned IVP) instead of
     * relaxPath's boundary-value relaxation. Validated to dominate relaxPath on
     * reach (always 1.0 vs 0.10–0.93) and onPath (8/9 corpora) - see
     * scripts/dev/traverse_corpus_replication.ts. Set false to roll back to
     * relaxPath (kept intact, including the GPU path and void expansion).
     */
    SETTLING_TRAVERSE_PRIMARY: true,
    /**
     * TRAVELER session lifecycle - Exponential decay applied to the Traveler's
     * accumulated position vector per cognitive tick when no traversal is in
     * progress.  Implements the gravitational attraction back toward the pole
     * described in the session lifecycle: each component decays by
     * (1 - POLE_IDLE_ATTRACTION) per tick.  0 disables drift; 1 snaps to
     * the pole instantly.  0.02 produces a half-life of ~34 ticks (~2.8 min
     * at the default 5 s cognitive tick cadence).
     */
    POLE_IDLE_ATTRACTION: 0.02,
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
    /** Maximum tension zones to ingest per dreamCycle invocation (prevents burst latency). */
    DREAM_ZONES_PER_CYCLE: 3,
  },

  atomizer: {
    /** Multiplier applied per triplet-inheritance nesting level ("the X" → 4×). */
    INHERITANCE_BASE_FACTOR: 4.0,
    /** Hard cap on accumulated inheritance multiplier (prevents runaway mass). */
    MAX_INHERITANCE_MASS_FACTOR: 16.0,
  },

  observability: {
    /** Emit a JSONL metrics snapshot every N ManifoldLifecycle ticks. */
    METRICS_EMIT_INTERVAL_TICKS: 100,
    /** Path for the append-only JSONL metrics log. */
    METRICS_LOG_PATH: "./logs/modpat_metrics.jsonl",
    /**
     * How often Runtime.startTick() fires the lightweight maintenance tick
     * (decay + age refresh).  Chosen to be slow enough not to interfere with
     * interactive REPL responsiveness while still providing meaningful decay.
     */
    TICK_INTERVAL_MS: 5000,
  },

  orbital: {
    /**
     * Base gravitational radius for an atom's zone of influence.
     * orbitRadius(id) = BASE_RADIUS × √(|mass| / (c² + |mass|))
     * Always in [0, BASE_RADIUS). Set to a meaningful fraction of typical
     * inter-atom spacing in the manifold.
     */
    BASE_RADIUS: 50.0,
    /**
     * Atoms with |mass| < system.c × MIN_PARENT_MASS_RATIO are "dust":
     * they never act as orbital parents even when geometrically close.
     */
    MIN_PARENT_MASS_RATIO: 0.1,
  },
};

export function validateConfig(): void {
  const { mapper, memory, structural } = DOPAT_CONFIG;

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
  DOPAT_CONFIG,
  FULL_DIRECTIONAL_PATTERNS,
  LOGIC_PATTERNS,
  RESOLVER_ACTIONS,
  RIGHT_DIRECTIONAL_PATTERNS,
  SYSTEM_CONFIG,
};
