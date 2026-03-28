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
  /**
   * Creates a new persistence manager linked to a specific database connection.
   * @param connection - The active connection to the persistent store.
   */
  constructor(private connection: DuckDBConnection) {}

  /**
   * Freezes the current state of the logical universe into the persistent store.
   *
   * This method captures all physical attributes of every logic atom (precept)
   * currently active in the system, including their gravitational mass,
   * temporal state, and spatial coordinates within the manifold.
   *
   * @param system - The integral logic system to snapshot.
   */
  async snapshot(system: System): Promise<void> {
    // Clear existing precepts to make room for the new universal state
    await this.connection.run("DELETE FROM precepts");

    const appender = await this.connection.createAppender("precepts");

    for (let i = 0; i < system.length; i++) {
      appender.appendUInteger(i); // id
      appender.appendDouble(system.mass[i]);
      appender.appendDouble(system.scope[i]);
      appender.appendDouble(system.time[i]);
      appender.appendDouble(system.density[i]);
      appender.appendDouble(system.entropy[i]);
      appender.appendDouble(system.posX[i]);
      appender.appendDouble(system.posY[i]);
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
  }

  /**
   * Thaws a previously frozen logical universe, restoring all physical properties.
   *
   * This method re-populates the system arrays with the saved attributes of
   * logic atoms, effectively resetting the manifold to a specific historical state.
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
      system.time[id] = Number(row[3]);
      system.density[id] = Number(row[4]);
      system.entropy[id] = Number(row[5]);
      system.posX[id] = Number(row[6]);
      system.posY[id] = Number(row[7]);
      system.checksum[id] = Number(row[8]);
      system.PartLayer[id] = Number(row[9]);
      system.ComplexLayer[id] = Number(row[10]);
      system.operatorClass[id] = Number(row[11]);
    }

    // @ts-expect-error: updating private length for hydration
    system.length = length;
  }

  /**
   * Analytical Query: Locates massive logical bodies (operators) within
   * a specific spatial radius of a point in the manifold.
   *
   * This is used to identify high-gravity zones that might influence
   * geodesic pathfinding.
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
    const res = await this.connection.run(`
      SELECT id FROM precepts 
      WHERE mass > ${minMass} 
      AND (sqrt(pow(posX - ${centerX}, 2) + pow(posY - ${centerY}, 2)) <= ${radius})
    `);
    const rows = await res.getRows();
    return (rows || []).map(row => Number(row[0]));
  }

  /**
   * Versioning: Tags the current snapshot of the logical universe with a
   * specific epoch identifier.
   *
   * This allows for time-traveling through different versions of the
   * logical evolution.
   *
   * @param epochId - A unique string identifying the logical epoch.
   */
  public async tagSnapshot(epochId: string): Promise<void> {
    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS snapshots AS SELECT * FROM precepts WHERE 1=0;
      ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS epoch_id VARCHAR;
      
      INSERT INTO snapshots 
      SELECT *, '${epochId}' as epoch_id FROM precepts;
    `);
  }
}
