import assert from "node:assert/strict";
import {
  fuzzyAnd,
  fuzzyOr,
  fuzzyNot,
  subsethood,
  evalFormula,
  entailment,
  type ManifoldRegion,
  type FormulaNode,
} from "@core_s/FrameworkIndex";
import { describe, it } from "./utils/harness";

// --- helpers -----------------------------------------------------------------

function makeRegion(entries: [number, number][]): ManifoldRegion {
  return new Map(entries);
}

export async function runFuzzyConnectivesTests() {
  await describe("E1 – Fuzzy connectives", async () => {
    // -- t-norm axioms: AND ------------------------------------------------

    await it("AND is commutative", async () => {
      const A = makeRegion([
        [1, 0.8],
        [2, 0.5],
        [3, 0.3],
      ]);
      const B = makeRegion([
        [1, 0.6],
        [2, 0.9],
        [4, 0.7],
      ]);
      const ab = fuzzyAnd(A, B);
      const ba = fuzzyAnd(B, A);
      assert.deepStrictEqual(
        new Map([...ab].sort((x, y) => x[0] - y[0])),
        new Map([...ba].sort((x, y) => x[0] - y[0]))
      );
    });

    await it("AND is monotone: A' ≤ A implies AND(A', B) ≤ AND(A, B)", async () => {
      const A = makeRegion([
        [1, 0.8],
        [2, 0.6],
      ]);
      const Ap = makeRegion([
        [1, 0.4],
        [2, 0.3],
      ]); // A' ≤ A
      const B = makeRegion([
        [1, 0.7],
        [2, 0.5],
      ]);
      const abOrig = fuzzyAnd(A, B);
      const abPrime = fuzzyAnd(Ap, B);
      for (const [id, val] of abOrig) {
        const vp = abPrime.get(id) ?? 0;
        assert.ok(
          vp <= val + 1e-9,
          `AND(A',B)[${id}]=${vp} > AND(A,B)[${id}]=${val}`
        );
      }
    });

    await it("AND with disjoint supports returns empty region", async () => {
      const A = makeRegion([
        [1, 0.8],
        [2, 0.5],
      ]);
      const B = makeRegion([
        [3, 0.6],
        [4, 0.4],
      ]);
      const result = fuzzyAnd(A, B);
      assert.strictEqual(result.size, 0);
    });

    // -- t-conorm axioms: OR -----------------------------------------------

    await it("OR is commutative", async () => {
      const A = makeRegion([
        [1, 0.3],
        [2, 0.8],
      ]);
      const B = makeRegion([
        [1, 0.6],
        [3, 0.4],
      ]);
      const ab = fuzzyOr(A, B);
      const ba = fuzzyOr(B, A);
      const sortFn = (x: [number, number], y: [number, number]) => x[0] - y[0];
      assert.deepStrictEqual([...ab].sort(sortFn), [...ba].sort(sortFn));
    });

    await it("OR with disjoint supports returns the union", async () => {
      const A = makeRegion([
        [1, 0.5],
        [2, 0.3],
      ]);
      const B = makeRegion([
        [3, 0.7],
        [4, 0.2],
      ]);
      const result = fuzzyOr(A, B);
      assert.strictEqual(result.size, 4);
      assert.strictEqual(result.get(1), 0.5);
      assert.strictEqual(result.get(3), 0.7);
    });

    await it("OR picks max on overlapping atoms", async () => {
      const A = makeRegion([
        [1, 0.3],
        [2, 0.9],
      ]);
      const B = makeRegion([
        [1, 0.8],
        [2, 0.4],
      ]);
      const result = fuzzyOr(A, B);
      assert.ok(Math.abs((result.get(1) ?? 0) - 0.8) < 1e-9);
      assert.ok(Math.abs((result.get(2) ?? 0) - 0.9) < 1e-9);
    });

    // -- NOT ---------------------------------------------------------------

    await it("NOT: complement of full support returns zeros", async () => {
      const universe = makeRegion([
        [1, 0.6],
        [2, 0.4],
      ]);
      const A = makeRegion([
        [1, 0.6],
        [2, 0.4],
      ]); // A == universe
      const result = fuzzyNot(A, universe);
      // All atoms clamped to 0, none stored
      assert.strictEqual(result.size, 0);
    });

    await it("NOT: complement of empty set returns the universe", async () => {
      const universe = makeRegion([
        [1, 0.6],
        [2, 0.4],
      ]);
      const empty = makeRegion([]);
      const result = fuzzyNot(empty, universe);
      assert.strictEqual(result.size, 2);
      assert.ok(Math.abs((result.get(1) ?? 0) - 0.6) < 1e-9);
      assert.ok(Math.abs((result.get(2) ?? 0) - 0.4) < 1e-9);
    });

    // -- IMPLIES / subsethood ----------------------------------------------

    await it("subsethood returns 1 when A is nested in B", async () => {
      const A = makeRegion([
        [1, 0.3],
        [2, 0.5],
      ]);
      const B = makeRegion([
        [1, 0.8],
        [2, 0.9],
      ]); // B everywhere ≥ A
      const s = subsethood(A, B);
      assert.ok(Math.abs(s - 1.0) < 1e-9, `Expected 1, got ${s}`);
    });

    await it("subsethood returns 0 for disjoint supports", async () => {
      const A = makeRegion([
        [1, 0.5],
        [2, 0.3],
      ]);
      const B = makeRegion([
        [3, 0.7],
        [4, 0.2],
      ]);
      const s = subsethood(A, B);
      assert.ok(Math.abs(s) < 1e-9, `Expected 0, got ${s}`);
    });

    await it("subsethood returns 0 for empty premise", async () => {
      const A = makeRegion([]);
      const B = makeRegion([[1, 0.5]]);
      const s = subsethood(A, B);
      assert.ok(Math.abs(s) < 1e-9, `Expected 0 for empty A, got ${s}`);
    });

    // -- Formula AST -------------------------------------------------------

    await it("evalFormula: region leaf returns the region itself", async () => {
      const r = makeRegion([
        [1, 0.5],
        [2, 0.3],
      ]);
      const node: FormulaNode = { type: "region", region: r };
      const result = evalFormula(node);
      assert.strictEqual(result, r);
    });

    await it("evalFormula: AND node calls fuzzyAnd bottom-up", async () => {
      const A = makeRegion([
        [1, 0.6],
        [2, 0.4],
      ]);
      const B = makeRegion([
        [1, 0.8],
        [2, 0.2],
      ]);
      const node: FormulaNode = {
        type: "and",
        left: { type: "region", region: A },
        right: { type: "region", region: B },
      };
      const result = evalFormula(node);
      assert.ok(Math.abs((result.get(1) ?? 0) - 0.6) < 1e-9);
      assert.ok(Math.abs((result.get(2) ?? 0) - 0.2) < 1e-9);
    });

    await it("entailment: A ⊆ B returns 1", async () => {
      const A = makeRegion([[1, 0.2]]);
      const B = makeRegion([[1, 0.9]]);
      const node: FormulaNode & { type: "implies" } = {
        type: "implies",
        premise: { type: "region", region: A },
        conclusion: { type: "region", region: B },
      };
      const e = entailment(node);
      assert.ok(Math.abs(e - 1.0) < 1e-9, `Expected entailment=1, got ${e}`);
    });

    await it("entailment: disjoint A and B returns 0", async () => {
      const A = makeRegion([[1, 0.5]]);
      const B = makeRegion([[2, 0.5]]);
      const node: FormulaNode & { type: "implies" } = {
        type: "implies",
        premise: { type: "region", region: A },
        conclusion: { type: "region", region: B },
      };
      const e = entailment(node);
      assert.ok(Math.abs(e) < 1e-9, `Expected entailment=0, got ${e}`);
    });
  });
}
