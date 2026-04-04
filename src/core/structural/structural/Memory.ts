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
        signature VARCHAR PRIMARY KEY,
        target_pattern VARCHAR,
        net_energy DOUBLE
      );
    `);
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

      // Robust Identification: If it has OperatorClass.None, it is a variable/atom.
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

      // If it's a variable (low mass), use its mapped VAR_X placeholder
      if (this.system.mass[id] <= this.system.epsilon * 10) {
        targetTokens.push(`VAR_${varMap.get(scope)}`);
      } else {
        // Operators retain their symbol
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

    const stmt = await this._connection.prepare(`
      INSERT INTO wave_forms (signature, target_pattern, net_energy) 
      VALUES (?, ?, ?) 
      ON CONFLICT (signature) DO UPDATE SET net_energy = EXCLUDED.net_energy;
    `);

    try {
      stmt.bindVarchar(1, signature);
      stmt.bindVarchar(2, targetPattern);
      stmt.bindDouble(3, energy);
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

    const reverseVarMap = new Map<number, number>();
    for (const [scope, varId] of varMap.entries()) {
      reverseVarMap.set(varId, scope);
    }

    let targetPattern: string | null = null;

    const stmt = await this._connection.prepare(
      `SELECT target_pattern FROM wave_forms WHERE signature = ?`
    );
    try {
      stmt.bindVarchar(1, signature);
      const res = await stmt.runAndReadAll();
      const rows = res.getRows();
      if (rows && rows.length > 0) {
        // Correctly access the target_pattern from the second column (index 1)
        targetPattern = rows[0][1]?.toString() || null;
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
        const opId = this.findOperatorIdBySymbol(inputSequence, token);
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
