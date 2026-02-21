import { type DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";

/**
 * DatabaseContext serves as the environmental architect for the persistent
 * logical universe.
 *
 * It manages the lifecycle of the DuckDB connection and ensures that the
 * underlying physical structures (schema) required to store logic atoms
 * and system metadata are correctly established.
 */
export class DatabaseContext {
  /** The DuckDB instance representing the persistent manifold. */
  private instance?: DuckDBInstance;
  /** The active connection to the persistent manifold. */
  private connection?: DuckDBConnection;

  /**
   * Creates a new database context.
   * @param dbPath - The file path to the persistent manifold (defaults to :memory:).
   */
  constructor(private dbPath: string = ":memory:") {}

  /**
   * Establishes a stable connection to the persistent manifold.
   *
   * If the connection is not yet active, it initializes the DuckDB instance
   * and ensures the logical schema is ready for use.
   *
   * @returns The active DuckDBConnection.
   */
  async connect(): Promise<DuckDBConnection> {
    if (!this.instance) {
      this.instance = await DuckDBInstance.create(this.dbPath);
      this.connection = await this.instance.connect();
      await this.initializeSchema();
    }
    return this.connection!;
  }

  /**
   * Defines the fundamental laws and structures of the persistent logical universe.
   *
   * This method initializes the `precepts` table, which stores the physical
   * properties of every logic atom (mass, entropy, spatial coordinates, etc.),
   * and the `system_metadata` table for universal constants.
   *
   * @private
   */
  private async initializeSchema(): Promise<void> {
    if (!this.connection) return;

    await this.connection.run(`
      CREATE TABLE IF NOT EXISTS precepts (
        id UINTEGER PRIMARY KEY,
        mass DOUBLE,
        scope DOUBLE,
        time DOUBLE,
        density DOUBLE,
        entropy DOUBLE,
        posX DOUBLE,
        posY DOUBLE,
        checksum DOUBLE,
        part_layer UINTEGER,
        complex_layer UINTEGER,
        operator_class UTINYINT
      );

      CREATE TABLE IF NOT EXISTS system_metadata (
        key VARCHAR PRIMARY KEY,
        value VARCHAR
      );
    `);
  }

  /**
   * Terminating the link and dissolving the persistent manifold from the
   * current execution context.
   */
  async close(): Promise<void> {
    if (this.connection) {
      this.connection.disconnectSync();
      this.connection = undefined;
    }
    this.instance = undefined;
  }
}
