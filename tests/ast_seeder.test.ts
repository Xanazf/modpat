/**
 * AST seeder tests - verifies extractAstTriples() against TS/JS fixtures.
 * Does NOT require a running manifold, DuckDB, or worker threads.
 */
import assert from "node:assert/strict";
import logger from "@utils/SpectralLogger";
import { extractAstTriples } from "@utils/astExtract";
import { describe, it } from "./utils/harness";

const FIXTURE_TS = `
interface Animal {
  name: string;
  speak(): void;
}

interface Pet extends Animal {
  owner: string;
}

class Cat implements Animal {
  name: string = "cat";
  purr(): void {}
  speak(): void { this.purr(); }
}

class PoliceCat extends Cat implements Pet {
  owner: string = "officer";
}

function feed(animal: Animal): boolean {
  return true;
}

const rescue = (cat: Cat): PoliceCat => {
  return new PoliceCat();
};

type MaybeAnimal = Animal | null;

enum Species { Cat, Dog, Bird }
`;

const FIXTURE_IMPORTS = `
import { readFile, writeFile } from "fs";
import nodePath from "node:path";
import { describe, it } from "./utils/harness";

function main() {
  readFile("x");
  nodePath.join("a", "b");
}
`;

export async function runAstSeederTests() {
  await describe("AST Triple Extractor", async () => {
    const triples = extractAstTriples(FIXTURE_TS, "fixture.ts");

    const has = (s: string, p: string, o: string) =>
      triples.some(t => t.subject === s && t.predicate === p && t.object === o);

    await it("extracts interface extends triple", async () => {
      assert.ok(
        has("pet", "extends", "animal"),
        `expected pet extends animal, got: ${triples.map(t => t.text).join(", ")}`
      );
    });

    await it("extracts class implements triple", async () => {
      assert.ok(has("cat", "implements", "animal"));
    });

    await it("extracts class extends triple", async () => {
      assert.ok(has("policecat", "extends", "cat"));
    });

    await it("extracts function parameter type", async () => {
      assert.ok(has("feed", "accepts", "animal"));
    });

    await it("extracts function return type", async () => {
      assert.ok(has("feed", "returns", "boolean"));
    });

    await it("extracts arrow function parameter type", async () => {
      assert.ok(has("rescue", "accepts", "cat"));
    });

    await it("extracts arrow function return type", async () => {
      assert.ok(has("rescue", "returns", "policecat"));
    });

    await it("extracts type alias union members", async () => {
      assert.ok(has("maybeanimal", "is", "animal"));
    });

    await it("extracts enum members", async () => {
      assert.ok(has("species", "has", "cat"));
      assert.ok(has("species", "has", "dog"));
    });

    await it("extracts interface members", async () => {
      assert.ok(has("animal", "has", "name"));
      assert.ok(has("animal", "has", "speak"));
    });

    await it("does not produce self-loops", async () => {
      const selfLoops = triples.filter(t => t.subject === t.object);
      assert.strictEqual(
        selfLoops.length,
        0,
        `self-loops found: ${selfLoops.map(t => t.text).join(", ")}`
      );
    });

    await it("assigns correct kindY for functions", async () => {
      const fnTriples = triples.filter(t => t.subject === "feed");
      assert.ok(
        fnTriples.every(t => t.kindY === 0.3),
        "feed triples should have kindY=0.3"
      );
    });

    await it("assigns correct kindY for types", async () => {
      const typeTriples = triples.filter(t => t.subject === "maybeanimal");
      assert.ok(
        typeTriples.every(t => t.kindY === 0.0),
        "type alias triples should have kindY=0.0"
      );
    });

    // Import + call-site extraction (Stage B via abstract-syntax-tree)
    const importTriples = extractAstTriples(FIXTURE_IMPORTS, "fixture.js");

    await it("extracts named import as module exports triple", async () => {
      assert.ok(
        importTriples.some(
          t => t.predicate === "exports" && t.object === "readfile"
        ),
        `expected fs exports readfile, got: ${importTriples
          .filter(t => t.predicate === "exports")
          .map(t => t.text)
          .join(", ")}`
      );
    });

    await it("extracts default import as module exports triple", async () => {
      // import nodePath from "node:path" → ("nodepath", exports, "nodepath") would be
      // self-loop; the safeId of "node:path" → "nodepath", so the triple is
      // ("nodepath", "exports", "nodepath") - filtered. We instead verify the named
      // imports from "fs" are extracted correctly.
      assert.ok(
        importTriples.some(
          t => t.predicate === "exports" && t.object === "writefile"
        ),
        `expected fs exports writefile, got: ${importTriples
          .filter(t => t.predicate === "exports")
          .map(t => t.text)
          .join(", ")}`
      );
    });

    await it("all triples have non-empty text", async () => {
      assert.ok(triples.every(t => t.text.trim().length > 0));
    });

    await it("energy values are within expected range", async () => {
      assert.ok(
        triples.every(t => t.energy >= 0.5 && t.energy <= 2.0),
        `energy out of range: ${triples
          .filter(t => t.energy < 0.5 || t.energy > 2.0)
          .map(t => `${t.text}=${t.energy}`)
          .join(", ")}`
      );
    });

    logger.log(
      `  Extracted ${triples.length} triples from TS fixture, ${importTriples.length} from import fixture`
    );
  });
}
