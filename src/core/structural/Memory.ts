import type System from "@core_i/System";
import { OperatorClass } from "@core_i/System";
import Atomizer from "@atomics/LogicAtomizer";
import {
  type DuckDBConnection,
  DuckDBInstance,
  listValue,
} from "@duckdb/node-api";

/**
 * Represents the stable, collapsed state of a logical derivation.
 * A WaveForm captures the relationship between input generic variables
 * and their resolved output quanta.
 */
interface WaveForm {
  /** The universal topological signature of the input interference pattern. */
  signature: string;
  /** The target to match the interference pattern against. */
  target_pattern: string;
  /** The stored net energy of the pattern. */
  net_energy: number;
  /** The coordinates of the pattern in the manifold. */
  anchor_x: number;
  anchor_y: number;
  anchor_z: number;
  anchor_w: number;
  /** Indices mapping the generic variable placeholders to the physical output. */
  source_indices: Uint32Array;
}

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
  /** Reference to the integral system state. */
  private system: System;
  /** The atomic engine for encoding/decoding logic quanta. */
  private atomizer: Atomic.Engine;
  /** File path to the database (defaults to :memory:). */
  private dbPath: string;
  /** Promise that resolves when the vault is fully initialized. */
  private initPromise: Promise<void>;

  /**
   * Initializes a new persistent vault.
   *
   * @param system - The integral logic system.
   * @param atomizer - The structural atomizer for quantum processing.
   * @param dbPath - The path to the persistent DuckDB file.
   */
  constructor(
    system: System,
    atomizer: Atomic.Engine,
    dbPath: string = ":memory:"
  ) {
    this.system = system;
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
        anchor_w DOUBLE
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
        // Column already exists in this DuckDB build — safe to ignore
      }
    }
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
      z = 0,
      w = 0;
    const count = ids.length;
    if (count === 0) return [0, 0, 0, 0];

    for (let i = 0; i < count; i++) {
      const id = ids[i];
      x += this.system.posX[id];
      y += this.system.posY[id];
      z += this.system.posZ[id];
      w += this.system.posW[id];
    }
    return [x / count, y / count, z / count, w / count];
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

      // If it has OperatorClass.None, it is a variable/atom.
      // Otherwise, it is an operator with fixed logical mass.
      if (this.system.operatorClass[id] === OperatorClass.None) {
        if (!varMap.has(scope)) {
          varMap.set(scope, nextVarId++);
        }
        signatureTokens.push(`VAR_${varMap.get(scope)}`);
      } else {
        // Operators retain their physical identity in the topology
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

      // Use VAR placeholder only if it was part of the original input manifold
      if (
        this.system.mass[id] <= this.system.epsilon * 10 &&
        varMap.has(scope)
      ) {
        targetTokens.push(`VAR_${varMap.get(scope)}`);
      } else {
        // Operators or new variables not in the input retain their literal identity
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
    energy: number
  ) {
    const { signature, varMap } = this.abstractSequence(inputSequence);
    const targetPattern = this.abstractTarget(outputSequence, varMap);
    const [ax, ay, az, aw] = this.calculateCentroid(inputSequence);

    // Deduplicate: if this exact abstract signature already exists at a spatially
    // close anchor (within 0.5 units), update its energy rather than inserting a
    // duplicate row. This prevents unbounded table growth from repeated ingestion
    // of the same fact while preserving spatial diversity for distinct contexts.
    const checkStmt = await this._connection.prepare(`
      SELECT net_energy FROM wave_forms
      WHERE signature = ?
        AND ABS(anchor_x - ?) < 0.5
        AND ABS(anchor_y - ?) < 0.5
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
      // Only write back if the new proof carries higher confidence
      if (energy > existingEnergy) {
        const upd = await this._connection.prepare(`
          UPDATE wave_forms SET net_energy = ?
          WHERE signature = ?
            AND ABS(anchor_x - ?) < 0.5
            AND ABS(anchor_y - ?) < 0.5
        `);
        try {
          upd.bindDouble(1, energy);
          upd.bindVarchar(2, signature);
          upd.bindDouble(3, ax);
          upd.bindDouble(4, ay);
          await upd.run();
        } finally {
          upd.destroySync();
        }
      }
      return;
    }

    const stmt = await this._connection.prepare(`
      INSERT INTO wave_forms (signature, target_pattern, net_energy, anchor_x, anchor_y, anchor_z, anchor_w)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.bindVarchar(1, signature);
      stmt.bindVarchar(2, targetPattern);
      stmt.bindDouble(3, energy);
      stmt.bindDouble(4, ax);
      stmt.bindDouble(5, ay);
      stmt.bindDouble(6, az);
      stmt.bindDouble(7, aw);
      await stmt.run();
    } finally {
      stmt.destroySync();
    }
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
    inputSequence: Uint32Array
  ): Promise<Uint32Array | null> {
    const { signature, varMap } = this.abstractSequence(inputSequence);
    const [qx, qy, qz, qw] = this.calculateCentroid(inputSequence);

    const reverseVarMap = new Map<number, number>();
    for (const [scope, varId] of varMap.entries()) {
      reverseVarMap.set(varId, scope);
    }

    let targetPattern: string | null = null;

    // Spatial Resonance Query: Find the structurally identical signature that is physically closest to our query
    const stmt = await this._connection.prepare(`
      SELECT target_pattern,
             (pow(anchor_x - ?, 2) + pow(anchor_y - ?, 2) + pow(anchor_z - ?, 2) + pow(anchor_w - ?, 2)) as resonance
      FROM wave_forms
      WHERE signature = ?
      ORDER BY resonance ASC
      LIMIT 1
    `);
    try {
      stmt.bindDouble(1, qx);
      stmt.bindDouble(2, qy);
      stmt.bindDouble(3, qz);
      stmt.bindDouble(4, qw);
      stmt.bindVarchar(5, signature);

      const res = await stmt.runAndReadAll();
      const rows = res.getRows();
      if (rows && rows.length > 0) {
        const resonance = Number(rows[0][1]);
        // Tight Resonance Threshold:
        // A distance < 0.1 indicates the query is physically targeting the same logical entity.
        // A larger distance suggests a structural coincidence but a different topological identity.
        if (resonance < 0.1) {
          targetPattern = rows[0][0]?.toString() || null;
        }
      }
    } catch (err) {
      console.error("Vault Interference Query Error:", err);
    } finally {
      stmt.destroySync();
    }

    if (!targetPattern) return null;

    const targetTokens = targetPattern.split(",");
    const resultIds: number[] = [];

    for (const token of targetTokens) {
      if (token.startsWith("VAR_")) {
        const varId = parseInt(token.replace("VAR_", ""), 10);
        const physicalScope = reverseVarMap.get(varId);

        // Find the corresponding quantum in the input sequence that matches the scope
        for (let i = 0; i < inputSequence.length; i++) {
          if (
            this.system.scope[inputSequence[i]] === physicalScope &&
            this.system.mass[inputSequence[i]] <= this.system.epsilon * 10
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

    return new Uint32Array(resultIds);
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
   * Periodically clears out cached patterns that have accumulated zero or negative energy.
   * This permanently removes "hallucinated" or incorrect logical paths.
   */
  public async cullWeakWaveForms(): Promise<void> {
    await this._connection.run("DELETE FROM wave_forms WHERE net_energy <= 0");
  }

  /**
   * Flushes all cached wave forms from the vault, resetting the derivation memory.
   */
  public async flush(): Promise<void> {
    await this._connection.run("DELETE FROM wave_forms");
  }

  /**
   * Closes the vault connection and releases DuckDB resources.
   */
  public async close(): Promise<void> {
    if (this._connection) {
      this._connection.disconnectSync();
    }
  }
}
