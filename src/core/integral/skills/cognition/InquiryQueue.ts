/**
 * InquiryQueue - the system's backlog of things it does not understand.
 *
 * Tracks topics that returned "unknown" so the system can reason about them
 * proactively: pending → tried_dict → tried_wiki → ask_user → resolved.
 *
 * Previously lived alongside Learner.  Phase 3 of the "Traveler as Thinker"
 * refactor extracted it so the Traveler can own an instance directly while
 * `Learner.ts` becomes a back-compat shim.
 */

import type Store from "@core_s/Memory";
import type Unfolder from "@core_s/Unfolder";
import type Traveler from "@core_i/Traveler";
import logger from "@utils/SpectralLogger";

export type InquiryStatus =
  | "pending"
  | "tried_dict"
  | "tried_wiki"
  | "ask_user"
  | "resolved";

export interface InquiryItem {
  id: string;
  topic: string;
  originalQuery: string;
  status: InquiryStatus;
  addedAt: number;
  attempts: number;
}

export class InquiryQueue {
  private items: Map<string, InquiryItem> = new Map();
  private store?: Store;
  /** Optional hook called on each new enqueue - used by Traveler.spawnIntent. */
  public onEnqueue?: (topic: string) => void;

  constructor(store?: Store) {
    this.store = store;
  }

  /** Bulk-load items from a previous session (called once at boot). */
  public populate(items: InquiryItem[]): void {
    for (const item of items) {
      if (!this.items.has(item.id)) this.items.set(item.id, item);
    }
  }

  private _persist(): void {
    this.store
      ?.saveInquiryQueue([...this.items.values()])
      .catch(e => logger.warn("[INQUIRY PERSIST]", e));
  }

  public enqueue(topic: string, originalQuery: string): void {
    const id = topic.toLowerCase().trim();
    if (!id || this.items.has(id)) return;
    this.items.set(id, {
      id,
      topic: id,
      originalQuery,
      status: "pending",
      addedAt: Date.now(),
      attempts: 0,
    });
    logger.debug(`[INQUIRY] enqueued "${id}"`);
    this._persist();
    this.onEnqueue?.(id);
  }

  /**
   * Immediately escalates a topic to `ask_user` status, bypassing the
   * dict/wiki resolution pipeline.
   */
  public enqueueImmediate(topic: string, originalQuery: string): void {
    const id = topic.toLowerCase().trim();
    if (!id || this.items.has(id)) return;
    this.items.set(id, {
      id,
      topic: id,
      originalQuery,
      status: "ask_user",
      addedAt: Date.now(),
      attempts: 0,
    });
    logger.debug(`[INQUIRY] immediate escalation "${id}"`);
    this._persist();
    this.onEnqueue?.(id);
  }

  public resolve(topic: string): void {
    const item = this.items.get(topic.toLowerCase().trim());
    if (item) {
      item.status = "resolved";
      logger.debug(`[INQUIRY] resolved "${topic}"`);
      this._persist();
    }
  }

  public checkForAnswers(text: string): void {
    const lower = text.toLowerCase();
    for (const item of this.items.values()) {
      if (item.status === "ask_user" && lower.includes(item.topic)) {
        item.status = "resolved";
        logger.debug(`[INQUIRY] auto-resolved "${item.topic}" from user input`);
      }
    }
  }

  public pendingUserQuestions(): InquiryItem[] {
    return [...this.items.values()].filter(i => i.status === "ask_user");
  }

  public get size(): number {
    return [...this.items.values()].filter(i => i.status !== "resolved").length;
  }

  public async step(
    limit: number,
    unfolder: Unfolder | null,
    mapper: Traveler,
    system: Root.ManifoldView,
    atomizer: Atomic.Engine,
    store?: Store,
    onResolved?: (item: InquiryItem, answer: string) => void
  ): Promise<InquiryItem[]> {
    const toAsk: InquiryItem[] = [];

    const candidates = [...this.items.values()]
      .filter(i => i.status === "pending" || i.status === "tried_dict")
      .slice(0, limit);

    for (const item of candidates) {
      item.attempts++;

      if (item.status === "pending" && unfolder?.dictionary.isReady) {
        const result = await unfolder.dictionary.expand(
          item.topic,
          system,
          atomizer,
          store
        );
        item.status = "tried_dict";
        if (result.found) {
          const answer = await this._retry(
            item,
            mapper,
            atomizer,
            system,
            store
          );
          if (answer !== null) {
            item.status = "resolved";
            onResolved?.(item, answer);
            continue;
          }
        }
      } else if (item.status === "pending") {
        item.status = "tried_dict";
      }

      if (item.status === "tried_dict" && unfolder) {
        const voidScope = atomizer.getSymbolScope("void", false);
        const voidId = system.createLocation(-system.c, voidScope);
        const expanded = await unfolder.expand(voidId, item.topic, store);
        item.status = "tried_wiki";
        if (expanded) {
          const answer = await this._retry(
            item,
            mapper,
            atomizer,
            system,
            store
          );
          if (answer !== null) {
            item.status = "resolved";
            onResolved?.(item, answer);
            continue;
          }
        }
      }

      if (item.status === "tried_wiki" || item.status === "tried_dict") {
        item.status = "ask_user";
        toAsk.push(item);
        logger.debug(`[INQUIRY] escalating "${item.topic}" to user`);
      }
    }

    return toAsk;
  }

  private async _retry(
    item: InquiryItem,
    mapper: Traveler,
    atomizer: Atomic.Engine,
    system: Root.ManifoldView,
    store?: Store
  ): Promise<string | null> {
    const q = item.originalQuery.includes("|-")
      ? item.originalQuery
      : `${item.originalQuery} |-`;
    const ids = atomizer.ingestSequence(q, system);
    const result = await mapper.perceiveCoherent(ids, { maxIterations: 2 });
    const decoded = atomizer.decodeSequence(result.ids, system).trim();
    if (result.diagnosis === "coherent" && decoded && decoded !== "unknown") {
      logger.debug(`[INQUIRY] retry resolved "${item.topic}" → "${decoded}"`);
      if (store) {
        await store.crystallizeProof(ids, result.ids, 1.1);
      }
      return decoded;
    }
    return null;
  }
}

export default InquiryQueue;
