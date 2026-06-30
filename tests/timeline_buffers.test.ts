import assert from "node:assert/strict";
import System from "@core_i/System";
import { describe, it } from "./utils/harness";

/**
 * Guard suite for the bitemporal timeline buffers (THEORY.md "Potentially better
 * System documentation", PosW: timestamp + age; #1 signed timeline, #2 influence
 * intervals).
 *
 * Pins the contract BEFORE the buffers land, so the behaviour can't silently
 * regress the way the resonance path did. RED until ManifoldSOA gains the three
 * F64 buffers and System exposes the getters + derived helpers:
 *
 *   wBirth  - transaction time: when the system LEARNED the precept. Written
 *             once at allocation, never re-anchored, never decayed.
 *   wStart  - valid-from: when the precept's influence begins (may be < wBirth
 *             for historical facts; > systemAge for predictions / the "will" case).
 *   wStop   - valid-to: when influence ends. Opens to `maxilon` (still influencing).
 *
 * Derived (no storage):
 *   isInfluencing(id)  wStart <= systemAge < wStop
 *   duration(id)       min(systemAge, wStop) - wStart
 *   isFuture(id)       wStart > systemAge
 *   isExpired(id)      wStop  <= systemAge
 *
 * The load-bearing claim: wBirth is the stable authoring timeline that
 * DirectionalPropagation SHOULD read instead of posW. posW is re-anchored to
 * systemAge on every vault hit (System.refreshConceptAge*), which destroys the
 * forward/backward direction signal; wBirth must survive that.
 */
export async function runTimelineBuffersTests() {
  await describe("BITEMPORAL TIMELINE BUFFERS (wBirth / wStart / wStop) - guard", async () => {
    await describe("Allocation defaults", async () => {
      await it("wBirth and wStart anchor to systemAge; wStop opens to maxilon", async () => {
        const sys = new System();
        sys.decay(2500); // advance the clock so values aren't trivially 0
        const now = sys.systemAge;

        const id = sys.createLocation(5.0, 1.0);

        assert.equal(
          sys.wBirth[id],
          now,
          "wBirth must anchor to systemAge at creation"
        );
        assert.equal(
          sys.wStart[id],
          now,
          "wStart must default to systemAge (valid-from = now)"
        );
        assert.equal(
          sys.wStop[id],
          sys.maxilon,
          "wStop must open to maxilon (still influencing)"
        );
        assert.equal(
          sys.isInfluencing(id),
          true,
          "a freshly created precept is influencing now"
        );
        assert.equal(sys.isFuture(id), false);
        assert.equal(sys.isExpired(id), false);
      });
    });

    await describe("Immutability under decay", async () => {
      await it("wBirth survives decay ticks while posW fades", async () => {
        const sys = new System();
        const id = sys.createLocation(5.0, 1.0);
        const birth = sys.wBirth[id];

        // posW is the volatile freshness signal - seed it so we can watch it fade.
        sys.posW[id] = 1.0;
        sys.update(id);

        for (let k = 0; k < 8; k++) sys.decay(1000);

        assert.equal(
          sys.wBirth[id],
          birth,
          "wBirth must be byte-identical after decay ticks"
        );
        assert.ok(
          sys.posW[id] < 1.0,
          `posW must fade under decay (got ${sys.posW[id]}); proves the two are distinct quantities`
        );
      });

      await it("wStart / wStop are not faded by decay", async () => {
        const sys = new System();
        const id = sys.createLocation(5.0, 1.0);
        const start = sys.wStart[id];
        const stop = sys.wStop[id];

        for (let k = 0; k < 8; k++) sys.decay(1000);

        assert.equal(
          sys.wStart[id],
          start,
          "wStart is a timeline coord - never decayed"
        );
        assert.equal(
          sys.wStop[id],
          stop,
          "wStop is a timeline coord - never decayed"
        );
      });
    });

    await describe("Slot reuse hygiene", async () => {
      await it("freeLocation clears the timeline; a reused slot inherits nothing", async () => {
        const sys = new System();
        const first = sys.createLocation(5.0, 1.0);
        sys.wStart[first] = -123; // historical
        sys.wStop[first] = 999;
        sys.update(first);

        sys.freeLocation(first, "guard");
        assert.equal(sys.wBirth[first], 0);
        assert.equal(sys.wStart[first], 0);
        assert.equal(sys.wStop[first], 0);

        // Force the free-list path so the slot is reused.
        sys.decay(1000);
        const reused = sys.createLocation(5.0, 1.0);
        assert.equal(reused, first, "expected the freed slot to be reused");
        assert.equal(
          sys.wStart[reused],
          sys.systemAge,
          "reused slot must re-anchor, not inherit -123"
        );
        assert.equal(
          sys.wStop[reused],
          sys.maxilon,
          "reused slot must reopen, not inherit 999"
        );
      });
    });

    await describe("Valid-time semantics (interval #2)", async () => {
      await it("historical fact: wStart precedes wBirth (the signed / 'before epoch' case)", async () => {
        const sys = new System();
        sys.decay(5000);
        const id = sys.createLocation(5.0, 1.0);

        // "The system learned today about something true since long ago."
        sys.wStart[id] = -1000;
        sys.update(id);

        assert.ok(
          sys.wStart[id] < sys.wBirth[id],
          "valid-from precedes transaction time"
        );
        assert.equal(
          sys.isInfluencing(id),
          true,
          "still in effect: wStart <= now < wStop"
        );
      });

      await it("future assertion: wStart beyond now reads as not-yet-influencing ('will')", async () => {
        const sys = new System();
        sys.decay(2000);
        const id = sys.createLocation(5.0, 1.0);

        sys.wStart[id] = sys.systemAge + 1000; // a prediction / intent
        sys.update(id);

        assert.equal(sys.isFuture(id), true);
        assert.equal(
          sys.isInfluencing(id),
          false,
          "future influence is not active yet"
        );
      });

      await it("duration / isExpired track the interval against systemAge", async () => {
        const sys = new System();
        sys.decay(3000);
        const id = sys.createLocation(5.0, 1.0);

        sys.wStart[id] = sys.systemAge - 2.0;
        sys.wStop[id] = sys.systemAge + 2.0;
        sys.update(id);

        const expected =
          Math.min(sys.systemAge, sys.wStop[id]) - sys.wStart[id];
        assert.ok(
          Math.abs(sys.duration(id) - expected) < 1e-9,
          `duration must be min(now, wStop) - wStart (got ${sys.duration(id)}, want ${expected})`
        );
        assert.equal(sys.isExpired(id), false);

        // Close the interval in the past.
        sys.wStop[id] = sys.systemAge - 0.5;
        sys.update(id);
        assert.equal(sys.isExpired(id), true);
        assert.equal(sys.isInfluencing(id), false);
      });
    });

    await describe("Payoff: persistent timeline survives posW re-anchoring", async () => {
      await it("wBirth preserves authoring order after a refresh corrupts posW order", async () => {
        const sys = new System();

        const older = sys.createLocation(5.0, 1.0); // born first
        sys.decay(3000); // clock advances
        const newer = sys.createLocation(5.0, 1.0); // born later

        assert.ok(
          sys.wBirth[older] < sys.wBirth[newer],
          "authoring order recorded in wBirth"
        );

        // A vault hit on the OLDER precept re-anchors its posW to `now`, making it
        // *look* newer than `newer` by the freshness coordinate - this is exactly
        // the corruption that makes posW unusable as a timeline.
        sys.refreshConceptAgeForIds([older]);
        assert.ok(
          sys.posW[older] >= sys.posW[newer],
          "re-anchoring inverted posW order (the corruption wBirth exists to avoid)"
        );

        // wBirth is unmoved: the true authoring order is still readable.
        assert.ok(
          sys.wBirth[older] < sys.wBirth[newer],
          "wBirth must be immune to refresh; this is what DirectionalPropagation should read"
        );
      });
    });
  });
}
