import Atomizer from "@atomics/LogicAtomizer";
import { DOPAT_CONFIG } from "@config";
import type System from "@core_i/System";
import {
  classifyOperatorToken,
  OperatorClass,
  SlotType,
  SystemRef,
} from "@core_i/System";
import { metrics } from "@core_s/Metrics";
import { topoSignatureJaccard } from "@core_s/TopologyMapper";
import {
  type DuckDBConnection,
  DuckDBInstance,
  listValue,
} from "@duckdb/node-api";
import { scopesInSameSupercluster } from "@mutate/FrameworkIndex";

/**
 * The Store (Vault) acts as the long-term memory for the logic engine.
 *
 * It crystallizes proven resolutions into persistent storage, allowing
 * the system to recall derivation paths without re-running intensive
 * physics-based pathfinding (geodesic pathfinding). It uses DuckDB
 * to manage the "Heat Field" templates and their collapsed wave forms.
 */
export default class Store implements Memory.Vault {
  /** The DuckDB instance for persistent storage. */
  private instance!: DuckDBInstance;
  /** The active connection to the persistent vault. */
  private _connection!: DuckDBConnection;
  /** Shared reference cell, swap fires on ManifoldLifecycle failover. */
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  /** The atomic engine for encoding/decoding logic quanta. */
  private atomizer: Atomic.Engine;
  /** File path to the database (defaults to :memory:). */
  private dbPath: string;
  /** Promise that resolves when the vault is fully initialized. */
  private initPromise: Promise<void>;
  /**
   * Latest three-tier framework index from ManifoldLifecycle.
   * Used by checkInterferencePattern to verify that factual abstract matches
   * belong to the same conceptual domain as the current query.
   */
  private _frameworkIndex: Mutation.FrameworkIndex | null = null;

  /**
   * Initializes a new persistent vault.
   *
   * @param system - The integral logic system.
   * @param atomizer - The structural atomizer for quantum processing.
   * @param dbPath - The path to the persistent DuckDB file.
   */
  constructor(
    system: Root.ManifoldView | SystemRef,
    atomizer: Atomic.Engine,
    dbPath: string = ":memory:"
  ) {
    this.systemRef =
      system instanceof SystemRef ? system : new SystemRef(system);
    this.atomizer = atomizer;
    this.dbPath = dbPath;
    this.initPromise = this.init();
  }

  /**
   * Sets up the DuckDB environment and ensures the wave form table exists.
   * @private
   */
  private async init() {
    this.instance = await DuckDBInstance.create(this.dbPath);
    this._connection = await this.instance.connect();
    await this._connection.run(`
      CREATE TABLE IF NOT EXISTS wave_forms (
        signature VARCHAR,
        target_pattern VARCHAR,
        net_energy DOUBLE,
        anchor_x DOUBLE,
        anchor_y DOUBLE,
        anchor_z DOUBLE,
        anchor_w DOUBLE,
        slot_flags BIGINT DEFAULT 0,
        grid_x INTEGER,
        grid_y INTEGER,
        grid_z INTEGER,
        grid_w INTEGER,
        usage_count INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_wave_sig ON wave_forms (signature);

      CREATE TABLE IF NOT EXISTS raw_facts (
        fact VARCHAR NOT NULL,
        source VARCHAR DEFAULT 'user',
        confidence DOUBLE DEFAULT 1.0,
        ingested_at BIGINT,
        signature VARCHAR
      );
      CREATE INDEX IF NOT EXISTS idx_raw_facts_sig ON raw_facts (signature);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_facts_fact ON raw_facts (fact);

      CREATE TABLE IF NOT EXISTS inquiries (
        id TEXT PRIMARY KEY,
        topic TEXT,
        original_query TEXT,
        status TEXT,
        added_at BIGINT,
        attempts INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS session_phi (
        scope DOUBLE PRIMARY KEY,
        phi   DOUBLE NOT NULL
      );

      CREATE TABLE IF NOT EXISTS traveler_sessions (
        session_id VARCHAR PRIMARY KEY,
        pos_x DOUBLE NOT NULL,
        pos_y DOUBLE NOT NULL,
        pos_z DOUBLE NOT NULL,
        pos_w DOUBLE NOT NULL,
        holonomy_json VARCHAR NOT NULL,
        active_frameworks_json VARCHAR NOT NULL,
        session_effort DOUBLE NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Idempotent migrations for columns added in later schema versions.
    for (const col of [
      "slot_flags BIGINT DEFAULT 0",
      "grid_x INTEGER",
      "grid_y INTEGER",
      "grid_z INTEGER",
      "grid_w INTEGER",
      "usage_count INTEGER DEFAULT 0",
      "knowledge_state INTEGER DEFAULT 0",
      "reproduction_count INTEGER DEFAULT 0",
      "context_hash VARCHAR DEFAULT ''",
      "topo_signature VARCHAR DEFAULT ''",
      "is_factual INTEGER DEFAULT 0",
      "framework_scope BIGINT DEFAULT 0",
    ]) {
      try {
        await this._connection.run(
          `ALTER TABLE wave_forms ADD COLUMN IF NOT EXISTS ${col}`
        );
      } catch {
        // Column already exists in this DuckDB build, safe to ignore
      }
    }

    // Backfill grid keys for any rows that pre-date this migration.
    const gc = DOPAT_CONFIG.memory.GRID_CELL;
    await this._connection.run(`
      UPDATE wave_forms
      SET grid_x = CAST(FLOOR(anchor_x / ${gc}) AS INTEGER),
          grid_y = CAST(FLOOR(anchor_y / ${gc}) AS INTEGER),
          grid_z = CAST(FLOOR(anchor_z / ${gc}) AS INTEGER),
          grid_w = CAST(FLOOR(anchor_w / ${gc}) AS INTEGER)
      WHERE grid_x IS NULL
    `);

    // Covering B-tree index, enables bounded grid-window scans in checkInterferencePattern.
    await this._connection.run(`
      CREATE INDEX IF NOT EXISTS idx_wave_forms_grid
        ON wave_forms (grid_x, grid_y, grid_z, grid_w)
    `);

    // Migrate existing raw_facts tables that may lack the newer columns
    for (const col of [
      "source VARCHAR DEFAULT 'user'",
      "confidence DOUBLE DEFAULT 1.0",
      "ingested_at BIGINT",
      "signature VARCHAR",
    ]) {
      try {
        await this._connection.run(
          `ALTER TABLE raw_facts ADD COLUMN IF NOT EXISTS ${col}`
        );
      } catch {
        // Column already exists in this DuckDB build, safe to ignore
      }
    }
  }

  /** Maps a coordinate to its grid cell integer. */
  private gridKey(v: number): number {
    return Math.floor(v / DOPAT_CONFIG.memory.GRID_CELL) | 0;
  }

  /**
   * Provide the latest FrameworkIndex so factual vault matches can be
   * validated against the current domain topology.  Call after each
   * ManifoldLifecycle.consolidateAround() to keep the index fresh.
   */
  public setFrameworkIndex(index: Mutation.FrameworkIndex | null): void {
    this._frameworkIndex = index;
  }

  /** Extract the scope of the first non-operator atom in a sequence. */
  private _primaryScope(ids: Uint32Array): bigint {
    for (const id of ids) {
      if (
        this.system.isAllocated(id) &&
        this.system.operatorClass[id] === OperatorClass.None
      ) {
        return BigInt(Math.round(this.system.scope[id]));
      }
    }
    return 0n;
  }

  /**
   * True when storedScope and queryScope refer to the same conceptual domain.
   * Phase 1: exact scope identity (same concept).
   * Phase 2: same supercluster in the current FrameworkIndex - allows related
   *          concepts that have clustered together (e.g. titanium ↔ iridium in
   *          the metallurgy supercluster) to share factual vault patterns.
   */
  private _fwScopeOverlap(storedScope: bigint, queryScope: bigint): boolean {
    if (storedScope === queryScope) return true;
    const index = this._frameworkIndex;
    if (!index) return false;
    return scopesInSameSupercluster(
      Number(storedScope),
      Number(queryScope),
      index,
      this.system
    );
  }

  /**
   * Returns the active database connection.
   */
  public get connection(): DuckDBConnection {
    return this._connection;
  }

  /**
   * Waits for the vault initialization to complete.
   */
  public async waitForInit(): Promise<void> {
    return this.initPromise;
  }

  /**
   * Calculates the centroid of a sequence of quanta in 4D space.
   */
  private calculateCentroid(ids: Uint32Array): number[] {
    let x = 0,
      y = 0,
      z = 0;
    // Exclude Sink-class tokens from the centroid: they are structural
    // terminators ("|-") whose posY and posW drift across sessions as
    // ManifoldLifecycle merges or reassigns Sink precepts.  Including them
    // makes the anchor unstable - a merged Sink at a different sequence
    // position silently breaks future Phase-0 lookups.
    //
    // posW is intentionally excluded from the centroid anchor.  Non-numeric
    // operator tokens receive posW = systemAge at ingestion, so a vault entry
    // stored at systemAge=0 has anchor_w≈0 while the same query at
    // systemAge=100 has qw≈100 - Δw²=10000 >> VAULT_QUERY_THRESHOLD, causing
    // every cross-time lookup to miss.  posX already encodes numeric value
    // (value * 2) with a wider spread than posW (value * 0.1), so no
    // discriminating power is lost.  The W dimension of the grid key was
    // already excluded for this same reason.
    let count = 0;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (this.system.operatorClass[id] === OperatorClass.Sink) continue;
      x += this.system.posX[id];
      y += this.system.posY[id];
      z += this.system.posZ[id];
      count++;
    }
    if (count === 0) return [0, 0, 0, 0];
    return [x / count, y / count, z / count, 0];
  }

  /**
   * Packs a varId→SlotType map into a single BigInt.
   * Layout: bits [N*5 .. N*5+4] = SlotType for VAR_N. Supports up to 12 VARs (60 bits).
   */
  public packSlotFlags(slots: Map<number, SlotType>): bigint {
    let flags = 0n;
    for (const [varId, slotType] of slots) {
      flags |= BigInt(slotType) << BigInt(varId * 5);
    }
    return flags;
  }

  /**
   * Unpacks a BigInt slot_flags value back into a varId→SlotType map.
   */
  public unpackSlotFlags(flags: bigint): Map<number, SlotType> {
    const result = new Map<number, SlotType>();
    const MASK = 0x1fn;
    for (let varId = 0; varId < 12; varId++) {
      const st = Number((flags >> BigInt(varId * 5)) & MASK) as SlotType;
      if (st !== SlotType.None) result.set(varId, st);
    }
    return result;
  }

  /**
   * Converts a specific sequence of logic atoms into a universal topological signature.
   *
   * This process transforms physical quanta into generic variable placeholders (VAR_X)
   * while preserving operator identities. This creates a "Heat Field" template
   * that can be matched against different but structurally identical logic configurations.
   *
   * @param sequenceIds - The atomized quanta to abstract.
   * @returns An object containing the string signature and a map of physical scopes to variable IDs.
   */
  public abstractSequence(sequenceIds: Uint32Array): {
    signature: string;
    varMap: Map<number, number>;
  } {
    const varMap = new Map<number, number>(); // Maps physical scope to VAR_X
    const signatureTokens: string[] = [];
    let nextVarId = 0;

    for (let i = 0; i < sequenceIds.length; i++) {
      const id = sequenceIds[i];
      const scope = this.system.scope[id];
      const symbol = this.atomizer
        .decodeSequence(new Uint32Array([id]), this.system)
        .trim();

      // If it has OperatorClass.None, it is a variable/atom - UNLESS it is a
      // numeric literal, in which case it is stored as its literal value.
      // This makes arithmetic signatures exact: "1 plus 2 equals |-" is a
      // distinct key from "2 plus 2 equals |-", removing the dependence on
      // spatial centroid proximity for arithmetic vault lookup.  Non-numeric
      // atoms continue to use VAR_N abstraction so logical templates like
      // "VAR_0 is VAR_1 |-" remain general.
      const isNumericLiteral =
        this.system.operatorClass[id] === OperatorClass.None &&
        /^\d+(\.\d+)?$/.test(symbol);

      if (isNumericLiteral) {
        // Numeric literals: store as-is - exact arithmetic matching.
        signatureTokens.push(symbol);
      } else if (this.system.operatorClass[id] === OperatorClass.None) {
        if (!varMap.has(scope)) {
          varMap.set(scope, nextVarId++);
        }
        signatureTokens.push(`VAR_${varMap.get(scope)}`);
      } else {
        // Operators retain their physical identity in the topology.
        signatureTokens.push(symbol);
      }
    }

    return {
      signature: signatureTokens.join(" "),
      varMap,
    };
  }

  /**
   * Maps the resolved output quanta back to the generic VAR signature.
   *
   * @param resultIds - The resulting quanta from a resolution.
   * @param varMap - The map generated during sequence abstraction.
   * @returns A string pattern representing the universal target quanta.
   * @private
   */
  private abstractTarget(
    resultIds: Uint32Array,
    varMap: Map<number, number>
  ): string {
    const targetTokens: string[] = [];

    for (let i = 0; i < resultIds.length; i++) {
      const id = resultIds[i];
      const scope = this.system.scope[id];
      const symbol = this.atomizer
        .decodeSequence(new Uint32Array([id]), this.system)
        .trim();

      // Use VAR placeholder for semantic atoms (operatorClass None) that appeared
      // in the input. Using operatorClass instead of a mass threshold avoids
      // misclassifying operators whose mass has decayed below the threshold.
      if (
        this.system.operatorClass[id] === OperatorClass.None &&
        varMap.has(scope)
      ) {
        targetTokens.push(`VAR_${varMap.get(scope)}`);
      } else {
        // Operators or atoms not in the original input retain their literal identity.
        targetTokens.push(symbol);
      }
    }
    return targetTokens.join(",");
  }

  /**
   * Crystallizes a proven resolution (wave collapse) into persistent storage.
   *
   * This records the transition from a logic topology (signature) to its
   * resolved outcome, allowing future interference patterns to bypass
   * deduction physics.
   *
   * @param inputSequence - The source quanta (the premise).
   * @param outputSequence - The derived quanta (the conclusion).
   * @param energy - The net energy or confidence level of the proof.
   */
  public async crystallizeProof(
    inputSequence: Uint32Array,
    outputSequence: Uint32Array,
    energy: number,
    slotFlags: bigint = 0n,
    topoSignature: string = ""
  ) {
    const { signature, varMap } = this.abstractSequence(inputSequence);
    const targetPattern = this.abstractTarget(outputSequence, varMap);
    const [ax, ay, az, aw] = this.calculateCentroid(inputSequence);

    // A proof is "factual" when its output contains at least one semantic atom
    // whose scope did NOT appear in the input (i.e. the conclusion introduces
    // new content rather than re-arranging input variables).  Factual proofs
    // must not match abstract signatures across different conceptual domains -
    // "sky is blue" should not answer "what is titanium?" via VAR_N generalisation.
    const isFactual = Array.from(outputSequence).some(
      id =>
        this.system.isAllocated(id) &&
        this.system.operatorClass[id] === OperatorClass.None &&
        !varMap.has(this.system.scope[id])
    );
    // The framework scope is the scope of the first non-operator input atom -
    // the "subject" of the proof.  This stable identifier lets checkInterference
    // verify that a factual abstract match originates from the same domain as
    // the current query, either by exact scope identity or by shared supercluster
    // membership in the current FrameworkIndex.
    const frameworkScope = this._primaryScope(inputSequence);

    // Deduplicate: if this exact abstract signature already exists at a spatially
    // close anchor (within 0.5 units), update its energy rather than inserting a
    // duplicate row. This prevents unbounded table growth from repeated ingestion
    // of the same fact while preserving spatial diversity for distinct contexts.
    const checkStmt = await this._connection.prepare(`
      SELECT net_energy FROM wave_forms
      WHERE signature = ?
        AND ABS(anchor_x - ?) < ${DOPAT_CONFIG.memory.VAULT_DEDUP_THRESHOLD}
        AND ABS(anchor_y - ?) < ${DOPAT_CONFIG.memory.VAULT_DEDUP_THRESHOLD}
      LIMIT 1
    `);
    let existingEnergy: number | null = null;
    try {
      checkStmt.bindVarchar(1, signature);
      checkStmt.bindDouble(2, ax);
      checkStmt.bindDouble(3, ay);
      const res = await checkStmt.runAndReadAll();
      const rows = res.getRows();
      if (rows && rows.length > 0) existingEnergy = Number(rows[0][0]);
    } finally {
      checkStmt.destroySync();
    }

    if (existingEnergy !== null) {
      // Always refresh the spatial anchor so that entries crystallised before a
      // posX normalisation change (e.g. "+" → UMAP(0) vs "plus" → UMAP(real))
      // get their centroid updated to the current canonical values.  Without
      // this, a stale anchor causes every subsequent query to miss the threshold.
      const upd = await this._connection.prepare(`
        UPDATE wave_forms
        SET net_energy = ?,
            target_pattern = ?,
            anchor_x = ?, anchor_y = ?, anchor_z = ?, anchor_w = ?,
            grid_x = ?, grid_y = ?, grid_z = ?, grid_w = ?,
            topo_signature = CASE WHEN ? != '' THEN ? ELSE topo_signature END,
            is_factual = ?,
            framework_scope = CASE WHEN COALESCE(framework_scope, 0) != 0 THEN framework_scope ELSE ? END
        WHERE signature = ?
          AND ABS(anchor_x - ?) < ${DOPAT_CONFIG.memory.VAULT_DEDUP_THRESHOLD}
          AND ABS(anchor_y - ?) < ${DOPAT_CONFIG.memory.VAULT_DEDUP_THRESHOLD}
      `);
      try {
        const newEnergy = Math.max(energy, existingEnergy);
        upd.bindDouble(1, newEnergy);
        upd.bindVarchar(2, targetPattern);
        upd.bindDouble(3, ax);
        upd.bindDouble(4, ay);
        upd.bindDouble(5, az);
        upd.bindDouble(6, aw);
        upd.bindInteger(7, this.gridKey(ax));
        upd.bindInteger(8, this.gridKey(ay));
        upd.bindInteger(9, this.gridKey(az));
        upd.bindInteger(10, this.gridKey(aw));
        upd.bindVarchar(11, topoSignature);
        upd.bindVarchar(12, topoSignature);
        upd.bindInteger(13, isFactual ? 1 : 0);
        upd.bindBigInt(14, frameworkScope);
        upd.bindVarchar(15, signature);
        upd.bindDouble(16, ax);
        upd.bindDouble(17, ay);
        await upd.run();
      } finally {
        upd.destroySync();
      }
      metrics.increment("vault.dedup_skip");
      return;
    }

    const stmt = await this._connection.prepare(`
      INSERT INTO wave_forms
        (signature, target_pattern, net_energy, anchor_x, anchor_y, anchor_z, anchor_w, slot_flags,
         grid_x, grid_y, grid_z, grid_w, topo_signature, is_factual, framework_scope)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.bindVarchar(1, signature);
      stmt.bindVarchar(2, targetPattern);
      stmt.bindDouble(3, energy);
      stmt.bindDouble(4, ax);
      stmt.bindDouble(5, ay);
      stmt.bindDouble(6, az);
      stmt.bindDouble(7, aw);
      stmt.bindBigInt(8, slotFlags);
      stmt.bindInteger(9, this.gridKey(ax));
      stmt.bindInteger(10, this.gridKey(ay));
      stmt.bindInteger(11, this.gridKey(az));
      stmt.bindInteger(12, this.gridKey(aw));
      stmt.bindVarchar(13, topoSignature);
      stmt.bindInteger(14, isFactual ? 1 : 0);
      stmt.bindBigInt(15, frameworkScope);
      await stmt.run();
    } finally {
      stmt.destroySync();
    }
    metrics.increment("vault.crystallize");
  }

  /**
   * Queries the vault for a pre-computed wave collapse that matches the input topology.
   *
   * If a matching interference pattern is found, it reconstructs the physical
   * quanta directly from the template, instantly "collapsing" the logical
   * state without further calculation.
   *
   * @param inputSequence - The quanta to check for existing interference patterns.
   * @returns The reconstructed output quanta, or null if no matching pattern is cached.
   */
  public async checkInterferencePattern(
    inputSequence: Uint32Array,
    topoSignature?: string
  ): Promise<{ ids: Uint32Array; slotFlags: bigint; energy: number } | null> {
    const { signature, varMap } = this.abstractSequence(inputSequence);
    const [qx, qy, qz, qw] = this.calculateCentroid(inputSequence);

    const reverseVarMap = new Map<number, number>();
    for (const [scope, varId] of varMap.entries()) {
      reverseVarMap.set(varId, scope);
    }

    let targetPattern: string | null = null;
    let slotFlags = 0n;
    let vaultEnergy = 0;

    // Grid-window spatial resonance query: coarse bucket filter reduces candidates from
    // O(rows_per_signature) to O(1) before the exact squared-distance fine filter.
    // posW is excluded from both the grid key and the resonance distance: non-numeric
    // operator tokens receive posW = systemAge at ingestion, so any cross-time lookup
    // (stored at systemAge=T1, queried at systemAge=T2) would produce Δw²=(T2-T1)² >>
    // VAULT_QUERY_THRESHOLD and always miss.  posX already encodes numeric value with
    // a wider spread (value*2 vs posW's value*0.1), so nothing is lost.
    const R = Math.ceil(
      DOPAT_CONFIG.memory.VAULT_QUERY_THRESHOLD / DOPAT_CONFIG.memory.GRID_CELL
    );
    const gx = this.gridKey(qx),
      gy = this.gridKey(qy),
      gz = this.gridKey(qz);

    const uw = DOPAT_CONFIG.memory.USAGE_WEIGHT;
    // Fetch up to 10 candidates when a topoSignature is provided for re-ranking.
    const limit = topoSignature ? 10 : 1;
    const stmt = await this._connection.prepare(`
      SELECT target_pattern, slot_flags, signature AS matched_sig,
             (pow(anchor_x - ?, 2) + pow(anchor_y - ?, 2) + pow(anchor_z - ?, 2)) as resonance,
             net_energy * (1 + LN(1 + COALESCE(usage_count, 0)) * ${uw}) AS combined_score,
             net_energy, COALESCE(topo_signature, '') AS topo_sig,
             COALESCE(is_factual, 0) AS is_factual,
             COALESCE(framework_scope, 0) AS framework_scope
      FROM wave_forms
      WHERE signature = ?
        AND (grid_x IS NULL OR grid_x BETWEEN ? AND ?)
        AND (grid_y IS NULL OR grid_y BETWEEN ? AND ?)
        AND (grid_z IS NULL OR grid_z BETWEEN ? AND ?)
      ORDER BY resonance ASC, combined_score DESC
      LIMIT ${limit}
    `);
    try {
      stmt.bindDouble(1, qx);
      stmt.bindDouble(2, qy);
      stmt.bindDouble(3, qz);
      stmt.bindVarchar(4, signature);
      stmt.bindInteger(5, gx - R);
      stmt.bindInteger(6, gx + R);
      stmt.bindInteger(7, gy - R);
      stmt.bindInteger(8, gy + R);
      stmt.bindInteger(9, gz - R);
      stmt.bindInteger(10, gz + R);

      const res = await stmt.runAndReadAll();
      const rows = res.getRows();
      if (rows && rows.length > 0) {
        // Filter to resonance threshold, then optionally re-rank by topo overlap.
        const candidates = rows.filter(
          row => Number(row[3]) < DOPAT_CONFIG.memory.VAULT_QUERY_THRESHOLD
        );

        let chosen = candidates[0];
        if (topoSignature && candidates.length > 1) {
          // Re-rank: primary key = topo Jaccard (descending), tiebreak = combined_score.
          let bestJaccard = -1;
          let bestScore = -1;
          for (const row of candidates) {
            const rowTopo = row[6]?.toString() ?? "";
            const j = topoSignatureJaccard(topoSignature, rowTopo);
            const score = Number(row[4]);
            if (j > bestJaccard || (j === bestJaccard && score > bestScore)) {
              bestJaccard = j;
              bestScore = score;
              chosen = row;
            }
          }
        }

        if (chosen) {
          // Framework scope guard: factual proofs (output introduced new content)
          // must originate from the same conceptual domain as the current query.
          // Phase 1 - exact scope identity; Phase 2 - shared supercluster once
          // the topology has been enriched (e.g. titanium ↔ iridium in metallurgy).
          // Structural proofs (all output variables derived from input variables)
          // are always safe to apply and bypass this check.
          const storedIsFactual = Number(chosen[7] ?? 0) !== 0;
          const storedFwScope = BigInt(String(chosen[8] ?? "0"));
          if (storedIsFactual && storedFwScope !== 0n) {
            const queryScope = this._primaryScope(inputSequence);
            if (
              queryScope !== 0n &&
              !this._fwScopeOverlap(storedFwScope, queryScope)
            ) {
              // Different domain - suppress this factual match entirely.
              metrics.increment("vault.framework_miss");
              targetPattern = null;
              chosen = null as any;
            }
          }
        }
        if (chosen) {
          targetPattern = chosen[0]?.toString() || null;
          slotFlags = BigInt(String(chosen[1] ?? "0"));
          vaultEnergy = Number(chosen[5] ?? 0);
          const matchedSig = chosen[2]?.toString() ?? null;
          if (matchedSig) {
            const conn = this._connection;
            const sig = matchedSig;
            (async () => {
              const upd = await conn.prepare(
                `UPDATE wave_forms SET usage_count = COALESCE(usage_count, 0) + 1 WHERE signature = ?`
              );
              upd.bindVarchar(1, sig);
              await upd.run();
              upd.destroySync();
            })().catch(() => {});
          }
        }
      }
    } catch (err) {
      console.error("Vault Interference Query Error:", err);
    } finally {
      stmt.destroySync();
    }

    if (!targetPattern) {
      metrics.increment("vault.miss");
      return null;
    }
    metrics.increment("vault.hit");

    const targetTokens = targetPattern.split(",");
    const resultIds: number[] = [];

    for (const token of targetTokens) {
      if (token.startsWith("VAR_")) {
        const varId = parseInt(token.replace("VAR_", ""), 10);
        const physicalScope = reverseVarMap.get(varId);

        // Find the corresponding quantum in the input sequence that matches the scope.
        // Use operatorClass (not mass) to identify semantic atoms, mass can decay
        // below the threshold on operators, causing silent misclassification.
        for (let i = 0; i < inputSequence.length; i++) {
          if (
            this.system.scope[inputSequence[i]] === physicalScope &&
            this.system.operatorClass[inputSequence[i]] === OperatorClass.None
          ) {
            resultIds.push(inputSequence[i]);
            break;
          }
        }
      } else {
        let opId = this.findOperatorIdBySymbol(inputSequence, token);
        if (opId === -1) {
          // Fallback: Find it globally if not in input
          const targetScope = (this.atomizer as any).getSymbolScope(token);
          for (let i = 0; i < this.system.length; i++) {
            if (
              this.system.scope[i] === targetScope &&
              this.system.isAllocated(i)
            ) {
              opId = i;
              break;
            }
          }
        }
        if (opId !== -1) resultIds.push(opId);
      }
    }

    return { ids: new Uint32Array(resultIds), slotFlags, energy: vaultEnergy };
  }

  /**
   * Locates the internal ID of a logical operator within a sequence based on its symbol.
   *
   * @param sequenceIds - The sequence to search.
   * @param symbol - The symbol of the operator (e.g., "AND", "OR").
   * @returns The internal quantum ID, or -1 if not found.
   * @private
   */
  private findOperatorIdBySymbol(
    sequenceIds: Uint32Array,
    symbol: string
  ): number {
    for (let i = 0; i < sequenceIds.length; i++) {
      const decoded = this.atomizer
        .decodeSequence(new Uint32Array([sequenceIds[i]]), this.system)
        .trim();
      if (decoded === symbol) return sequenceIds[i];
    }
    return -1;
  }

  /**
   * Adjusts the confidence level (net energy) of a crystallized wave form.
   * This implements Hebbian reinforcement based on feedback or consistency checks.
   *
   * @param signature - The signature of the wave form to adjust.
   * @param delta - The energy delta to apply.
   */
  public async adjustEnergy(signature: string, delta: number): Promise<void> {
    const stmt = await this._connection.prepare(`
      UPDATE wave_forms
      SET net_energy = net_energy + ?
      WHERE signature = ?
    `);
    try {
      stmt.bindDouble(1, delta);
      stmt.bindVarchar(2, signature);
      await stmt.run();
    } finally {
      stmt.destroySync();
    }
  }

  /**
   * Applies a multiplicative decay to usage_count across all stored patterns.
   * Called from cullWeakWaveForms so older popular patterns don't permanently dominate.
   */
  public async decayUsageCounts(): Promise<void> {
    const rate = DOPAT_CONFIG.memory.USAGE_DECAY_RATE;
    await this._connection.run(
      `UPDATE wave_forms SET usage_count = CAST(COALESCE(usage_count, 0) * ${rate} AS INTEGER) WHERE COALESCE(usage_count, 0) > 0`
    );
  }

  /**
   * Adjusts the usage_count of all wave forms matching the given signature.
   * Pass a positive delta for positive feedback (FEEDBACK_BOOST), or 0 to zero out
   * (negative feedback - let decay remove it, don't delete immediately).
   */
  public async adjustUsageCount(
    signature: string,
    delta: number
  ): Promise<void> {
    if (delta <= 0) {
      const stmt = await this._connection.prepare(
        `UPDATE wave_forms SET usage_count = 0 WHERE signature = ?`
      );
      try {
        stmt.bindVarchar(1, signature);
        await stmt.run();
      } finally {
        stmt.destroySync();
      }
    } else {
      const stmt = await this._connection.prepare(
        `UPDATE wave_forms SET usage_count = COALESCE(usage_count, 0) + ? WHERE signature = ?`
      );
      try {
        stmt.bindInteger(1, Math.round(delta));
        stmt.bindVarchar(2, signature);
        await stmt.run();
      } finally {
        stmt.destroySync();
      }
    }
  }

  /**
   * Periodically clears out cached patterns that have accumulated zero or negative energy.
   * This permanently removes "hallucinated" or incorrect logical paths.
   */
  public async cullWeakWaveForms(): Promise<void> {
    await this._connection.run("DELETE FROM wave_forms WHERE net_energy <= 0");
    await this.decayUsageCounts();
  }

  /**
   * Returns up to `limit` crystallized facts that haven't yet been reproduced
   * independently, ordered by lowest reproduction_count first so the least-proven
   * facts are challenged before well-established ones.
   */
  public async sampleForChallenge(
    limit: number
  ): Promise<Memory.ChallengeCandidate[]> {
    // Use a CTE that picks the highest-energy wave_form per signature so the
    // join with raw_facts is always 1:1 (S2 - JOIN ambiguity fix).
    const stmt = await this._connection.prepare(`
      WITH best_wave AS (
        SELECT signature,
               target_pattern,
               MAX(net_energy)          AS net_energy,
               MAX(knowledge_state)     AS knowledge_state,
               MAX(reproduction_count)  AS reproduction_count,
               MAX(context_hash)        AS context_hash
        FROM wave_forms
        WHERE COALESCE(knowledge_state, 0) < 3
          AND net_energy > 0
        GROUP BY signature, target_pattern
      )
      SELECT r.fact, bw.signature, bw.target_pattern,
             COALESCE(bw.reproduction_count, 0) AS reproduction_count,
             COALESCE(bw.knowledge_state, 0)    AS knowledge_state,
             COALESCE(bw.context_hash, '')       AS context_hash
      FROM raw_facts r
      JOIN best_wave bw ON r.signature = bw.signature
      WHERE r.fact IS NOT NULL AND LENGTH(r.fact) > 0
      ORDER BY COALESCE(bw.reproduction_count, 0) ASC, bw.net_energy DESC
      LIMIT ?
    `);
    try {
      stmt.bindInteger(1, limit);
      const res = await stmt.runAndReadAll();
      return res.getRows().map(row => ({
        factText: String(row[0] ?? ""),
        signature: String(row[1] ?? ""),
        targetPattern: String(row[2] ?? ""),
        reproductionCount: Number(row[3] ?? 0),
        knowledgeState: Number(row[4] ?? 0) as Memory.KnowledgeState,
        contextHash: String(row[5] ?? ""),
      }));
    } finally {
      stmt.destroySync();
    }
  }

  /**
   * Updates the knowledge state, reproduction count, and context fingerprints
   * for a crystallized wave form identified by signature.
   */
  public async updateKnowledgeState(
    signature: string,
    state: Memory.KnowledgeState,
    repCount: number,
    ctxHash: string
  ): Promise<void> {
    const stmt = await this._connection.prepare(`
      UPDATE wave_forms
      SET knowledge_state    = ?,
          reproduction_count = ?,
          context_hash       = ?
      WHERE signature = ?
    `);
    try {
      stmt.bindInteger(1, state);
      stmt.bindInteger(2, repCount);
      stmt.bindVarchar(3, ctxHash);
      stmt.bindVarchar(4, signature);
      await stmt.run();
    } finally {
      stmt.destroySync();
    }
  }

  /**
   * Returns a count of crystallized proofs per knowledge state tier.
   */
  public async getKnowledgeSummary(): Promise<{
    heard: number;
    remembered: number;
    learned: number;
    generalized: number;
  }> {
    const res = await this._connection.run(`
      SELECT COALESCE(knowledge_state, 0) AS ks, COUNT(*) AS cnt
      FROM wave_forms
      GROUP BY ks
    `);
    const rows = (await res.getRows()) as [number | bigint, number | bigint][];
    const map: Record<number, number> = {};
    for (const [ks, cnt] of rows) {
      map[Number(ks)] = Number(cnt);
    }
    return {
      heard: map[0] ?? 0,
      remembered: map[1] ?? 0,
      learned: map[2] ?? 0,
      generalized: map[3] ?? 0,
    };
  }

  /**
   * Flushes all cached wave forms from the vault, resetting the derivation memory.
   */
  public async flush(): Promise<void> {
    await this._connection.run("DELETE FROM wave_forms");
  }

  /**
   * Returns all raw_facts that share the same subject and predicate prefix but
   * have a different object - i.e. facts that would contradict a new assertion.
   * Used by AstSeedWorker before crystallizing high-energy triples so stale
   * signatures (e.g. old return types after a refactor) get penalized.
   */
  public async findContradictingFacts(
    subject: string,
    predicate: string
  ): Promise<string[]> {
    const prefix = `${subject.toLowerCase()} ${predicate.toLowerCase()} `;
    const stmt = await this._connection.prepare(
      `SELECT fact FROM raw_facts WHERE fact LIKE ? LIMIT 20`
    );
    try {
      stmt.bindVarchar(1, `${prefix}%`);
      const res = await stmt.runAndReadAll();
      return res
        .getRows()
        .map(row => String(row[0] ?? ""))
        .filter(Boolean);
    } finally {
      stmt.destroySync();
    }
  }

  /**
   * Checks whether the exact fact string exists in the persistent vault.
   * Used by the contradiction detector as a pre-ingestion check that does not
   * create any manifold precepts.
   */
  /**
   * Inserts a fact text into raw_facts so Phase 2 vault search can find it.
   * Idempotent: skips silently if the fact already exists.
   */
  public async storeFact(
    fact: string,
    source: string,
    confidence: number,
    signature: string
  ): Promise<void> {
    const stmt = await this._connection.prepare(
      `INSERT INTO raw_facts (fact, source, confidence, ingested_at, signature)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`
    );
    try {
      stmt.bindVarchar(1, fact);
      stmt.bindVarchar(2, source);
      stmt.bindDouble(3, confidence);
      stmt.bindBigInt(4, BigInt(Date.now()));
      stmt.bindVarchar(5, signature);
      await stmt.run();
    } finally {
      stmt.destroySync();
    }
  }

  /** Checks whether a raw fact string already exists in the vault. Used for contradiction detection. */
  public async rawFactExists(fact: string): Promise<boolean> {
    const stmt = await this._connection.prepare(
      `SELECT 1 FROM raw_facts WHERE fact = ? LIMIT 1`
    );
    try {
      stmt.bindVarchar(1, fact);
      const res = await stmt.runAndReadAll();
      return res.getRows().length > 0;
    } finally {
      stmt.destroySync();
    }
  }

  /** Persists the full InquiryQueue state, replacing any prior rows. */
  public async saveInquiryQueue(items: Memory.InquiryItem[]): Promise<void> {
    await this._connection.run("DELETE FROM inquiries");
    for (const item of items) {
      const stmt = await this._connection.prepare(
        `INSERT INTO inquiries (id, topic, original_query, status, added_at, attempts)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`
      );
      try {
        stmt.bindVarchar(1, item.id);
        stmt.bindVarchar(2, item.topic);
        stmt.bindVarchar(3, item.originalQuery);
        stmt.bindVarchar(4, item.status);
        stmt.bindBigInt(5, BigInt(item.addedAt));
        stmt.bindInteger(6, item.attempts);
        await stmt.run();
      } finally {
        stmt.destroySync();
      }
    }
  }

  /** Loads unresolved InquiryQueue items from the vault. */
  public async loadInquiryQueue(): Promise<Memory.InquiryItem[]> {
    const stmt = await this._connection.prepare(
      `SELECT id, topic, original_query, status, added_at, attempts
       FROM inquiries WHERE status != 'resolved'`
    );
    try {
      const res = await stmt.runAndReadAll();
      return res.getRows().map(row => ({
        id: String(row[0] ?? ""),
        topic: String(row[1] ?? ""),
        originalQuery: String(row[2] ?? ""),
        status: String(row[3] ?? "pending") as Memory.InquiryStatus,
        addedAt: Number(row[4] ?? 0),
        attempts: Number(row[5] ?? 0),
      }));
    } finally {
      stmt.destroySync();
    }
  }

  /**
   * Computes the abstract VAR_N signature for a text string without creating
   * any manifold precepts. Mirrors the logic of abstractSequence() but operates
   * purely on the atomizer's symbol map and classifyOperatorToken().
   *
   * Used by the contradiction detector so it can query wave_forms without
   * ingesting the inverted statement into the live manifold.
   */
  public signatureForText(text: string): string {
    const tokens = text
      .replace(/\|-/g, " SINK_MARKER ")
      .replace(/([(){}[\]:;.,+\-*/=<>])/g, " $1 ")
      .replace(/SINK_MARKER/g, "|-")
      .split(/\s+/)
      .filter(t => t.length > 0);

    const varMap = new Map<number, number>();
    const parts: string[] = [];
    let nextVarId = 0;

    for (const token of tokens) {
      const norm = token.toLowerCase().trim();
      const isOp = classifyOperatorToken(norm) !== OperatorClass.None;
      // getSymbolScope() registers the symbol in the atomizer's symbolMap (no
      // manifold side effects) and returns the scope value used for VAR keying.
      const scope = this.atomizer.getSymbolScope(norm, isOp);

      if (isOp) {
        parts.push(norm);
      } else {
        if (!varMap.has(scope)) varMap.set(scope, nextVarId++);
        parts.push(`VAR_${varMap.get(scope)}`);
      }
    }

    return parts.join(" ");
  }

  /**
   * F4 - Snapshots the φ (density) field for all allocated atoms.
   * Keyed by scope (stable semantic identity across runs) so the saved state
   * survives a full process restart even when atom IDs differ.
   * Averaged per scope when multiple atoms share the same concept identity.
   */
  public async saveSessionPhi(system: Root.ManifoldView): Promise<void> {
    const blend = DOPAT_CONFIG.PHYSICS.PHI_SESSION_BLEND;
    const perScope = new Map<number, { sum: number; count: number }>();

    for (let i = 0; i < system.length; i++) {
      if (!system.isAllocated(i)) continue;
      const s = system.scope[i];
      const d = system.density[i];
      if (d <= 0) continue;
      const entry = perScope.get(s);
      if (entry) {
        entry.sum += d;
        entry.count++;
      } else {
        perScope.set(s, { sum: d, count: 1 });
      }
    }

    if (perScope.size === 0) return;

    await this._connection.run("BEGIN");
    try {
      await this._connection.run("DELETE FROM session_phi");
      const appender = await this._connection.createAppender("session_phi");
      for (const [scope, { sum, count }] of perScope) {
        appender.appendDouble(scope);
        appender.appendDouble((sum / count) * blend);
        appender.endRow();
      }
      appender.flushSync();
      appender.closeSync();
      await this._connection.run("COMMIT");
    } catch (err) {
      await this._connection.run("ROLLBACK");
      throw err;
    }
  }

  /**
   * F4 - Loads the saved session φ field as a scope → phi map.
   * Returns an empty map when no session has been persisted yet.
   */
  public async loadSessionPhi(): Promise<Map<number, number>> {
    const res = await this._connection.run(
      "SELECT scope, phi FROM session_phi"
    );
    const rows = await res.getRows();
    const map = new Map<number, number>();
    for (const row of rows ?? []) {
      map.set(Number(row[0]), Number(row[1]));
    }
    return map;
  }

  /**
   * TRAVELER step 2 - Upserts TravelerState for a session into DuckDB.
   */
  public async saveTravelerState(
    sessionId: string,
    state: Mutation.TravelerState
  ): Promise<void> {
    const holonomyJson = JSON.stringify(Array.from(state.holonomyFrame));
    const frameworksJson = JSON.stringify(Array.from(state.activeFrameworks));
    // DuckDB: delete-then-insert to achieve upsert without ON CONFLICT syntax variance.
    const del = await this._connection.prepare(
      `DELETE FROM traveler_sessions WHERE session_id = ?`
    );
    try {
      del.bindVarchar(1, sessionId);
      await del.run();
    } finally {
      del.destroySync();
    }
    const ins = await this._connection.prepare(
      `INSERT INTO traveler_sessions
         (session_id, pos_x, pos_y, pos_z, pos_w, holonomy_json, active_frameworks_json, session_effort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    try {
      ins.bindVarchar(1, sessionId);
      ins.bindDouble(2, state.position[0]);
      ins.bindDouble(3, state.position[1]);
      ins.bindDouble(4, state.position[2]);
      ins.bindDouble(5, state.position[3]);
      ins.bindVarchar(6, holonomyJson);
      ins.bindVarchar(7, frameworksJson);
      ins.bindDouble(8, state.sessionEffort);
      await ins.run();
    } finally {
      ins.destroySync();
    }
  }

  /**
   * TRAVELER step 2 - Loads TravelerState for the given session ID.
   * Returns null when no saved state exists.
   */
  public async loadTravelerState(
    sessionId: string
  ): Promise<Mutation.TravelerState | null> {
    const stmt = await this._connection.prepare(
      `SELECT pos_x, pos_y, pos_z, pos_w, holonomy_json, active_frameworks_json, session_effort
         FROM traveler_sessions WHERE session_id = ?`
    );
    let rows: any[][] | null = null;
    try {
      stmt.bindVarchar(1, sessionId);
      const res = await stmt.runAndReadAll();
      rows = res.getRows();
    } finally {
      stmt.destroySync();
    }
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    const holonomyArr: number[] = JSON.parse(String(row[4]));
    const frameworksArr: number[] = JSON.parse(String(row[5]));
    return {
      position: [
        Number(row[0]),
        Number(row[1]),
        Number(row[2]),
        Number(row[3]),
      ],
      holonomyFrame: new Float64Array(holonomyArr) as any,
      activeFrameworks: new Set(frameworksArr as any),
      sessionEffort: Number(row[6]),
    };
  }

  /**
   * Closes the vault connection and releases DuckDB resources.
   */
  public async close(): Promise<void> {
    if (this._connection) {
      this._connection.disconnectSync();
    }
    if (this.instance) {
      this.instance.closeSync();
    }
  }
}
