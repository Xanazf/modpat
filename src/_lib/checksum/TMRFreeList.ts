import { crc32 } from "./crc32";

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Hardened Triple Modular Redundancy free-list allocator (Option 5a).
 *
 * Each buffer carries a CRC32 checksum updated on every push/pop.
 * On vote:
 *  - CRC mismatch on one buffer → two-out-of-three majority silently corrects it.
 *  - CRC mismatch on two or three buffers, or value disagreement with all CRCs valid
 *    → quarantine: allocation halted, interruptHandler fired, "tmr.total_disagree" metric fired.
 *
 * Normal (no-corruption) pop fires the "tmr.agree" metric.
 * Majority-corrected pop fires the "tmr.corrected" metric.
 */
export class TMRFreeList implements Root.FreeList {
  private bufA: number[] = [];
  private bufB: number[] = [];
  private bufC: number[] = [];
  /** CRC32 checksum for each buffer, updated on every mutation. */
  private crcA = 0;
  private crcB = 0;
  private crcC = 0;
  /** Cached length; updated by push/pop so callers don't pay CRC cost on every read. */
  private _length = 0;
  private _halted = false;
  private _interruptHandler:
    | ((reason: string, values: number[]) => void)
    | null = null;

  /**
   * @param onMetric - Optional callback invoked with a metric name whenever
   * a TMR vote event occurs ("tmr.agree", "tmr.corrected", "tmr.total_disagree").
   * Keeps this primitive decoupled from any specific metrics backend.
   */
  constructor(private readonly onMetric?: (name: string) => void) {}

  /** Register a callback invoked on quarantine (three-way disagreement). */
  setInterruptHandler(h: (reason: string, values: number[]) => void): void {
    this._interruptHandler = h;
  }

  push(id: number): void {
    this.bufA.push(id);
    this.crcA = crc32(this.bufA);
    this.bufB.push(id);
    this.crcB = crc32(this.bufB);
    this.bufC.push(id);
    this.crcC = crc32(this.bufC);
    this._length++;
  }

  pop(): number | undefined {
    if (this._halted) return undefined;
    const { winner, corrected, failed } = this.computeVote();

    if (failed) {
      const top = [
        this.bufA.at(-1) ?? -1,
        this.bufB.at(-1) ?? -1,
        this.bufC.at(-1) ?? -1,
      ];
      this.quarantine("pop: three-way disagreement", top);
      return undefined;
    }
    if (winner!.length === 0) return undefined;

    this.onMetric?.(corrected ? "tmr.corrected" : "tmr.agree");

    const id = winner![winner!.length - 1];
    const next = winner!.slice(0, -1);
    // Normalise all three buffers to the agreed state (implicit resync of any outlier).
    this.bufA = [...next];
    this.crcA = crc32(this.bufA);
    this.bufB = [...next];
    this.crcB = crc32(this.bufB);
    this.bufC = [...next];
    this.crcC = crc32(this.bufC);
    this._length = next.length;
    return id;
  }

  get length(): number {
    return this._length;
  }

  /** Returns the consensus list, or null on total disagreement. */
  getVoted(): number[] | null {
    if (this._halted) return null;
    const { winner, failed } = this.computeVote();
    return failed ? null : [...winner!];
  }

  /** Test-only: push a value into bufA only, simulating silent buffer corruption. */
  injectCorruptionToBufferA(value: number): void {
    this.bufA.push(value);
    // Does NOT update crcA, CRC mismatch triggers correction on next vote.
  }

  /**
   * Test-only: overwrite a specific slot in one buffer without refreshing its CRC.
   * Simulates a single-bit flip; detected by the CRC check in computeVote().
   */
  corruptBuffer(
    bufferIndex: 0 | 1 | 2,
    offset: number,
    newValue: number
  ): void {
    const buf =
      bufferIndex === 0 ? this.bufA : bufferIndex === 1 ? this.bufB : this.bufC;
    if (offset >= 0 && offset < buf.length) buf[offset] = newValue;
    // Intentionally stale CRC after this call.
  }

  /** Returns true iff all three buffers currently hold identical contents. */
  allBuffersIdentical(): boolean {
    return (
      arraysEqual(this.bufA, this.bufB) && arraysEqual(this.bufB, this.bufC)
    );
  }

  isHalted(): boolean {
    return this._halted;
  }

  /** Returns true iff all three CRCs match their buffers (no undetected corruption). */
  verify(): boolean {
    return (
      crc32(this.bufA) === this.crcA &&
      crc32(this.bufB) === this.crcB &&
      crc32(this.bufC) === this.crcC
    );
  }

  private computeVote(): {
    winner: number[] | null;
    corrected: boolean;
    failed: boolean;
  } {
    const aOk = crc32(this.bufA) === this.crcA;
    const bOk = crc32(this.bufB) === this.crcB;
    const cOk = crc32(this.bufC) === this.crcC;
    const nFail = (aOk ? 0 : 1) + (bOk ? 0 : 1) + (cOk ? 0 : 1);

    if (nFail >= 2) return { winner: null, corrected: false, failed: true };

    // Exactly one CRC failure, the other two are the winners.
    if (!aOk) return { winner: this.bufB, corrected: true, failed: false };
    if (!bOk) return { winner: this.bufA, corrected: true, failed: false };
    if (!cOk) return { winner: this.bufA, corrected: true, failed: false };

    // All CRCs valid, value comparison for silent disagreements.
    if (arraysEqual(this.bufA, this.bufB) && arraysEqual(this.bufB, this.bufC))
      return { winner: this.bufA, corrected: false, failed: false };
    if (arraysEqual(this.bufA, this.bufB))
      return { winner: this.bufA, corrected: true, failed: false };
    if (arraysEqual(this.bufA, this.bufC))
      return { winner: this.bufA, corrected: true, failed: false };
    if (arraysEqual(this.bufB, this.bufC))
      return { winner: this.bufB, corrected: true, failed: false };

    return { winner: null, corrected: false, failed: true };
  }

  private quarantine(reason: string, values: number[]): void {
    this._halted = true;
    this.onMetric?.("tmr.total_disagree");
    this._interruptHandler?.(reason, values);
  }
}
