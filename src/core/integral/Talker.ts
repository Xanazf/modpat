/**
 * Talker - DEPRECATED. Phase 4 of the "Mapper as Thinker" refactor moved
 * assertion ingestion and SVO crystallization to Language.ingestAssertion().
 * This file remains as a back-compat shim. New code should use
 * Language.ingestAssertion() or Mapper.process() directly.
 */

import type Mapper from "./Mapper";

/** @deprecated Use Mapper.process() / Language.ingestAssertion() directly. */
class Talker {
  private mapper: Mapper;
  public lastSignature: string | null = null;
  public lastClarifyingQuestions: string[] = [];

  constructor(
    _system: unknown,
    _atomizer: unknown,
    _store: unknown,
    _respond?: unknown
  ) {
    // Mapper reference not available in this shim; all delegation to mapper.process
    // happens via Mapper's deprecated processCommand alias instead.
    this.mapper = null as any;
  }

  async processCommand(statement: string): Promise<string> {
    if (!this.mapper) return statement;
    const text = await this.mapper.process(statement);
    this.lastSignature = this.mapper.lastSignature;
    this.lastClarifyingQuestions = [];
    return text;
  }
}

export default Talker;
