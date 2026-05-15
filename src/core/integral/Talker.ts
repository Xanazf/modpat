import nlp from "compromise";
import { SystemRef } from "@core_i/System";
import type Store from "@core_s/Memory";
import logger from "@utils/SpectralLogger";
import { shiftPerspective } from "@core_s/Identity";

/**
 * Handles command processing: ingests declarative statements into the manifold
 * and DuckDB vault, with contradiction detection before committing.
 */
class Talker {
  private systemRef: SystemRef;
  private get system(): Root.ManifoldView {
    return this.systemRef.current;
  }
  private atomizer: Atomic.Engine;
  private store: Store;

  /** Signature of the last ingested command — read by LiveInference for feedback. */
  public lastSignature: string | null = null;
  private _respond: (msg: string) => void;

  constructor(
    systemRef: SystemRef,
    atomizer: Atomic.Engine,
    store: Store,
    respond?: (msg: string) => void
  ) {
    this.systemRef = systemRef;
    this.atomizer = atomizer;
    this.store = store;
    this._respond = respond ?? (msg => logger.log(`[LiveInference]: ${msg}`));
  }

  public async processCommand(statement: string): Promise<string> {
    // Shift second-person attributions to first-person so any fact containing
    // "you" is stored as a fact about the system itself ("i") in the manifold.
    const statement_ = shiftPerspective(statement);
    const doc = nlp(statement_);

    let invertedStatement = "";
    if (doc.has("#Negative")) {
      invertedStatement = doc.sentences().toPositive().text();
    } else {
      invertedStatement = doc.sentences().toNegative().text();
    }

    if (invertedStatement && invertedStatement !== statement_) {
      const contradicts = await this.store.rawFactExists(invertedStatement);
      if (contradicts) {
        const invertedSig = this.store.signatureForText(invertedStatement);
        await this.store.adjustEnergy(invertedSig, -0.5);
        const response = `[Logic Trap Detected]: Input contradicts known topological signature. Cached confidence penalized.`;
        this.respond(response);
        return response;
      }
    }

    const quanta = this.atomizer.ingestSequence(statement_, this.system);

    if (quanta.length > 0) {
      const { signature } = this.store.abstractSequence(quanta);
      this.lastSignature = signature;

      await this.store.crystallizeProof(quanta, quanta, 1.0);

      try {
        const stmt = await this.store.connection.prepare(
          `INSERT INTO raw_facts (fact, source, confidence, ingested_at, signature) VALUES (?, 'user', 1.0, ?, ?)`
        );
        stmt.bindVarchar(1, statement_);
        stmt.bindBigInt(2, BigInt(Date.now()));
        stmt.bindVarchar(3, signature);
        await stmt.run();
        stmt.destroySync();
      } catch (e) {
        logger.error("Vault Insert Error:", e);
      }

      const decodedMeaning = this.atomizer.decodeSequence(quanta, this.system);

      logger.wave("Ingest", this.system, quanta, this.atomizer);

      const response = `Acknowledged: "${decodedMeaning}"`;
      this.respond(response);
      return decodedMeaning;
    } else {
      const response = `Ignored (Unprocessable Input): "${statement}"`;
      this.respond(response);
      return response;
    }
  }

  private respond(response: string): void {
    this._respond(response);
  }
}

export default Talker;
