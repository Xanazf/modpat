/**
 * wiki.worker - Wikipedia / Context7 fetch in an isolated thread.
 *
 * Completely network-only; no SharedArrayBuffer, no DuckDB.
 * Isolates the HTTP client heap (axios, wikipedia) from the main GC.
 */

import { parentPort } from "node:worker_threads";
import axios from "axios";
import wiki from "wikipedia";

axios.defaults.headers.common["User-Agent"] =
  "MpatLogicEngine/1.0 (https://github.com/dopecodez/Wikipedia/)";

const CHAR_CAP = 6000;
const FETCH_TIMEOUT_MS = 8000;

async function fetchWikipedia(topic: string): Promise<string | null> {
  try {
    const content = await Promise.race([
      wiki.page(topic).then(p => p.content()),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), FETCH_TIMEOUT_MS)
      ),
    ]);
    const trimmed = (content as string)
      .slice(0, CHAR_CAP)
      .replace(/\n+/g, " ")
      .trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

parentPort!.on("message", async (msg: WorkerIPC.WikiRequest) => {
  const { id, topic } = msg;
  try {
    const result = await fetchWikipedia(topic);
    parentPort!.postMessage({ id, result });
  } catch (err: unknown) {
    parentPort!.postMessage({
      id,
      result: null,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
