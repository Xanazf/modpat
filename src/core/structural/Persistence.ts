import type System from "@core_i/System";
import type { DuckDBConnection } from "@duckdb/node-api";

/**
 * SystemPersistence is responsible for freezing and thawing the state of the
 * logical universe (the "System").
 *
 * It manages the persistence of "precepts"—the fundamental physical properties
 * of logic atoms like mass, entropy, and spatial coordinates. By snapshotting
 * the system, it allows the Modulating Attenuation Topology to be preserved
 * across execution cycles.
 */
export class SystemPersistence {
  /** Ensures system_deltas DDL is only executed once per connection lifetime. */
  private deltasTableInitialized = false;

  /**
   * Creates a new persistence manager linked to a specific database connection.
   * @param connection - The active connection to the persistent store.
   */
  constructor(private connection: DuckDBConnection) {}

  /**
   * Lazily creates the system_deltas table on first use.
   * Avoids running DDL on every delta log call.
   */
  private async ensureDeltasTable(): Promise<void> {
    if (this.deltasTableInitialized) return;
    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS system_deltas (
        timestamp BIGINT,
        precept_id INTEGER,
        field INTEGER,
        old_value DOUBLE,
        new_value DOUBLE
      )
    `);
    this.deltasTableInitialized = true;
  }

  /**
   * Freezes the current state of the logical universe into the persistent store.
   *
   * Runs inside a transaction so a mid-write crash leaves the previous snapshot
   * intact rather than an empty table. Skips freed (unallocated) slots to keep
   * the snapshot compact.
   *
   * @param system - The integral logic system to snapshot.
   */
  async snapshot(system: System): Promise<void> {
    await this.connection.run("BEGIN");
    try {
      await this.connection.run("DELETE FROM precepts");

      const appender = await this.connection.createAppender("precepts");

      for (let i = 0; i < system.length; i++) {
        // Skip freed slots — no need to persist unallocated positions
        if (!system.isAllocated(i)) continue;

        appender.appendUInteger(i); // id
        appender.appendDouble(system.mass[i]);
        appender.appendDouble(system.scope[i]);
        appender.appendDouble(system.depth[i]);
        appender.appendDouble(system.time[i]);
        appender.appendDouble(system.posX[i]);
        appender.appendDouble(system.posY[i]);
        appender.appendDouble(system.posZ[i]);
        appender.appendDouble(system.posW[i]);
        appender.appendDouble(system.density[i]);
        appender.appendDouble(system.entropyRate[i]);
        appender.appendDouble(system.potency[i]);
        appender.appendDouble(system.intensity[i]);
        appender.appendDouble(system.decayRate[i]);
        appender.appendDouble(system.checksum[i]);
        appender.appendUInteger(system.PartLayer[i]);
        appender.appendUInteger(system.ComplexLayer[i]);
        appender.appendUTinyInt(system.operatorClass[i]);
        appender.endRow();
      }

      appender.flushSync();
      appender.closeSync();

      // Store universal metadata required for restoration
      const stmt = await this.connection.prepare(
        "INSERT OR REPLACE INTO system_metadata (key, value) VALUES (?, ?)"
      );
      try {
        stmt.bindVarchar(1, "length");
        stmt.bindVarchar(2, system.length.toString());
        await stmt.run();
      } finally {
        stmt.destroySync();
      }

      await this.connection.run("COMMIT");
    } catch (err) {
      await this.connection.run("ROLLBACK");
      throw err;
    }
  }

  /**
   * Thaws a previously frozen logical universe, restoring all physical properties.
   *
   * Restores the `allocated` flag for every hydrated slot so that decay,
   * consolidation, and integrity-check routines see the nodes as active.
   *
   * @param system - The integral logic system to hydrate.
   */
  async hydrate(system: System): Promise<void> {
    const res = await this.connection.run(
      "SELECT value FROM system_metadata WHERE key = 'length'"
    );
    const rows = await res.getRows();
    if (!rows || rows.length === 0) return;

    const length = parseInt(rows[0][0]?.toString() || "0", 10);
    system.reset();

    const dataRes = await this.connection.run(
      "SELECT * FROM precepts ORDER BY id ASC"
    );
    const dataRows = await dataRes.getRows();

    if (!dataRows) return;

    for (const row of dataRows) {
      const id = Number(row[0]);
      system.mass[id] = Number(row[1]);
      system.scope[id] = Number(row[2]);
      system.depth[id] = Number(row[3]);
      system.time[id] = Number(row[4]);
      system.posX[id] = Number(row[5]);
      system.posY[id] = Number(row[6]);
      system.posZ[id] = Number(row[7]);
      system.posW[id] = Number(row[8]);
      system.density[id] = Number(row[9]);
      system.entropyRate[id] = Number(row[10]);
      system.potency[id] = Number(row[11]);
      system.intensity[id] = Number(row[12]);
      system.decayRate[id] = Number(row[13]);
      system.checksum[id] = Number(row[14]);
      system.PartLayer[id] = Number(row[15]);
      system.ComplexLayer[id] = Number(row[16]);
      system.operatorClass[id] = Number(row[17]);
      // Mark as active so all runtime subsystems (decay, consolidation, etc.) see this node
      system.allocated[id] = 1;
    }

    system.length = length;
  }

  /**
   * Analytical Query: Locates massive logical bodies (operators) within
   * a specific spatial radius of a point in the manifold.
   *
   * @param minMass - The minimum gravitational mass to consider.
   * @param centerX - The X coordinate of the search center.
   * @param centerY - The Y coordinate of the search center.
   * @param radius - The spatial radius to search within.
   * @returns A list of internal IDs for logic atoms matching the criteria.
   */
  public async queryHighMassInRadius(
    minMass: number,
    centerX: number,
    centerY: number,
    radius: number
  ): Promise<number[]> {
    const stmt = await this.connection.prepare(`
      SELECT id FROM precepts
      WHERE mass > ?
      AND (sqrt(pow(posX - ?, 2) + pow(posY - ?, 2)) <= ?)
    `);
    try {
      stmt.bindDouble(1, minMass);
      stmt.bindDouble(2, centerX);
      stmt.bindDouble(3, centerY);
      stmt.bindDouble(4, radius);
      const res = await stmt.runAndReadAll();
      return (res.getRows() || []).map(row => Number(row[0]));
    } finally {
      stmt.destroySync();
    }
  }

  /**
   * Versioning: Tags the current snapshot of the logical universe with a
   * specific epoch identifier.
   *
   * @param epochId - A unique string identifying the logical epoch.
   */
  public async tagSnapshot(epochId: string): Promise<void> {
    // Create the versioned archive table once (schema derived from precepts + epoch_id column)
    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS snapshots AS
      SELECT *, CAST('' AS VARCHAR) AS epoch_id
      FROM precepts
      WHERE FALSE
    `);
    const stmt = await this.connection.prepare(
      "INSERT INTO snapshots SELECT *, ? AS epoch_id FROM precepts"
    );
    try {
      stmt.bindVarchar(1, epochId);
      await stmt.run();
    } finally {
      stmt.destroySync();
    }
  }

  /**
   * Logs a state change delta for deterministic replay.
   *
   * @param preceptId - The ID of the logic atom.
   * @param field - The specific physical field that was updated.
   * @param oldValue - Value before the shift.
   * @param newValue - Value after the shift.
   */
  public async logDelta(
    preceptId: number,
    field: number,
    oldValue: number,
    newValue: number
  ): Promise<void> {
    await this.ensureDeltasTable();

    const stmt = await this.connection.prepare(
      "INSERT INTO system_deltas (timestamp, precept_id, field, old_value, new_value) VALUES (?, ?, ?, ?, ?)"
    );
    try {
      stmt.bindBigInt(1, BigInt(Date.now()));
      stmt.bindInteger(2, preceptId);
      stmt.bindInteger(3, field);
      stmt.bindDouble(4, oldValue);
      stmt.bindDouble(5, newValue);
      await stmt.run();
    } finally {
      stmt.destroySync();
    }
  }
}
