import { DOPAT_CONFIG } from "@config";
import { OperatorClass, type SystemRef } from "@core_i/System";
import { shiftPerspective } from "@core_s/Identity";
import type Store from "@core_s/Memory";
import logger from "@utils/SpectralLogger";
import nlp from "compromise";

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

  /** Signature of the last ingested command - read by LiveInference for feedback. */
  public lastSignature: string | null = null;
  /** Clarifying questions generated during the last processCommand call. */
  public lastClarifyingQuestions: string[] = [];
  private _respond: (msg: string) => void;

  /** Tokens that explicitly signal an undefined placeholder in a logical expression. */
  private static readonly PLACEHOLDER_RE = /^\[\]$|^\[\??\]$|^\?$|^_+$|^__\w*__$/;

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

  /**
   * Scans an ingested sequence for tokens that require clarification:
   *
   * Tier 1 - syntactic placeholders (`[]`, `?`, `_`) adjacent to an operator.
   *   These are always asked about immediately regardless of vault state.
   *
   * Tier 2 - repeated new concepts in compound statements (contains `&&`, `||`,
   *   `then`, `|-`). A token appearing 2+ times with an operator neighbour that
   *   has no prior vault presence is load-bearing and warrants follow-up.
   */
  private async detectClarificationNeeds(
    quanta: Uint32Array,
    statement: string
  ): Promise<string[]> {
    const questions: string[] = [];
    const seen = new Set<string>();
    const isCompound = /&&|\|\||then\b|therefore\b|\|-/.test(statement);

    const scopeCounts = new Map<number, number>();
    for (let i = 0; i < quanta.length; i++) {
      const scope = this.system.scope[quanta[i]];
      scopeCounts.set(scope, (scopeCounts.get(scope) ?? 0) + 1);
    }

    for (let i = 0; i < quanta.length; i++) {
      const id = quanta[i];
      if (!this.system.isAllocated(id)) continue;
      if (this.system.operatorClass[id] !== OperatorClass.None) continue;

      const label = this.atomizer.resolveScope(this.system.scope[id]) ?? "";
      if (!label || seen.has(label)) continue;

      const isPlaceholder = Talker.PLACEHOLDER_RE.test(label);
      const occurrences = scopeCounts.get(this.system.scope[id]) ?? 0;

      let opNeighbors = 0;
      if (i > 0 && this.system.operatorClass[quanta[i - 1]] !== OperatorClass.None)
        opNeighbors++;
      if (
        i < quanta.length - 1 &&
        this.system.operatorClass[quanta[i + 1]] !== OperatorClass.None
      )
        opNeighbors++;

      let shouldAsk = false;

      if (isPlaceholder && opNeighbors >= 1) {
        shouldAsk = true;
      } else if (isCompound && occurrences >= 2 && opNeighbors >= 1) {
        // Only ask about multi-occurrence tokens that have no prior vault presence.
        const isKnown = await this.store.connection
          .prepare("SELECT 1 FROM raw_facts WHERE fact LIKE ? LIMIT 1")
          .then(async stmt => {
            try {
              stmt.bindVarchar(1, `% ${label} %`);
              const res = await stmt.runAndReadAll();
              return res.getRows().length > 0;
            } finally {
              stmt.destroySync();
            }
          })
          .catch(() => true);
        if (!isKnown) shouldAsk = true;
      }

      if (shouldAsk) {
        seen.add(label);
        questions.push(`What is ${label}?`);
      }
    }

    return questions;
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

      // Self-loop: keeps the Learner's sampleForChallenge JOIN working (it
      // joins raw_facts.signature ↔ wave_forms.signature on this shape).
      await this.store.crystallizeProof(quanta, quanta, 1.0);

      // SVO split crystallization: adds a (subject+op+sink → object) entry
      // whose signature matches what Resolver and Listener Phase 0a use, so
      // a subsequent "what is X?" query finds the answer from the vault without
      // needing a full physics pass.
      //
      // Example: "fire is hot" → crystallize([fire, is, |-], [hot], 1.0).
      // Signature "VAR_0 is |-" matches Resolver Phase 0 and Listener Phase 0a.
      {
        const sinkScope = this.atomizer.getSymbolScope("|-", false);
        const sinkCandidates =
          sinkScope > 0 ? [...this.system.getIdsByScope(sinkScope)] : [];
        let sinkId = sinkCandidates.find(
          id =>
            this.system.isAllocated(id) &&
            this.system.operatorClass[id] === OperatorClass.Sink
        );
        // Background seeding (_seedSyllogisms) may not have created a Sink
        // precept yet when the first command is ingested. Create one on-the-fly
        // so the SVO crystallization can proceed. Both Talker (here) and Listener
        // Phase 0 call getIdsByScope(sinkScope) and take the first valid Sink, so
        // they will use the same precept → centroids match → vault hit succeeds.
        if (sinkId === undefined && sinkScope > 0) {
          sinkId = this.system.createLocation(
            this.system.c ** 2,
            sinkScope,
            "talker_sink_init"
          );
          this.system.operatorClass[sinkId] = OperatorClass.Sink;
          // Set posW = AGE_FRESHNESS (1.0) so the stored probe centroid and every
          // subsequent query centroid land in the same grid cell.  If left at 0,
          // reinforceVaultHit would later boost posW → 1.0, shifting the query's
          // grid_w away from the stored anchor and causing the grid filter to miss.
          this.system.posW[sinkId] = DOPAT_CONFIG.PHYSICS.AGE_FRESHNESS;
          this.system.update(sinkId);
        }
        if (sinkId !== undefined) {
          // Find the first operator that splits subject from object.
          let opIdx = -1;
          for (let i = 0; i < quanta.length; i++) {
            const cls = this.system.operatorClass[quanta[i]];
            if (
              cls === OperatorClass.IdentityShift ||
              cls === OperatorClass.Action
            ) {
              opIdx = i;
              break;
            }
          }
          if (opIdx > 0 && opIdx < quanta.length - 1) {
            const probeIds = new Uint32Array([
              ...quanta.subarray(0, opIdx + 1),
              sinkId,
            ]);
            const objectIds = quanta.subarray(opIdx + 1);
            // Arithmetic probes get higher initial energy so they survive
            // the Learner's cull cycles without requiring explicit positive
            // feedback - arithmetic facts are deterministic truths, not
            // probabilistic inferences that should decay without reinforcement.
            const hasArithmetic = Array.from(
              quanta.subarray(0, opIdx + 1)
            ).some(
              id => this.system.operatorClass[id] === OperatorClass.Arithmetic
            );
            const energy = hasArithmetic ? 3.0 : 1.0;
            await this.store.crystallizeProof(probeIds, objectIds, energy);

            // For commutative arithmetic operators (+, *) with two distinct
            // operands, also crystallize the reversed-operand probe so that
            // "B op A" resolves identically to "A op B" via an exact
            // signature match.
            // Pattern: [left, arithOp, right, eqOp, sink] where the SVO
            // split fired at the eq operator (opIdx=3 for simple binary
            // facts like "1+3=4").
            if (hasArithmetic && opIdx === 3 && quanta.length >= 5) {
              const arithmeticOpId = quanta[1];
              if (
                this.system.operatorClass[arithmeticOpId] ===
                OperatorClass.Arithmetic
              ) {
                const opLabel =
                  this.atomizer.resolveScope(
                    this.system.scope[arithmeticOpId]
                  ) ?? "";
                const isCommutative =
                  opLabel === "plus" || opLabel === "times";
                const leftId = quanta[0];
                const rightId = quanta[2];
                if (
                  isCommutative &&
                  this.system.scope[leftId] !== this.system.scope[rightId]
                ) {
                  const reversedProbe = new Uint32Array([
                    rightId,
                    arithmeticOpId,
                    leftId,
                    quanta[3], // the equals token
                    sinkId,
                  ]);
                  await this.store.crystallizeProof(
                    reversedProbe,
                    objectIds,
                    energy
                  );
                }
              }
            }
          }
        }
      }

      try {
        const stmt = await this.store.connection.prepare(
          `INSERT INTO raw_facts (fact, source, confidence, ingested_at, signature) VALUES (?, 'user', 1.0, ?, ?) ON CONFLICT DO NOTHING`
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

      this.lastClarifyingQuestions = await this.detectClarificationNeeds(
        quanta,
        statement_
      );
      for (const q of this.lastClarifyingQuestions) {
        this.respond(q);
      }

      const response = `Acknowledged: "${decodedMeaning}"`;
      this.respond(response);
      return decodedMeaning;
    } else {
      this.lastClarifyingQuestions = [];
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
