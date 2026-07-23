# Refactor

## extracting primitives (DONE)

1. `@src/_lib/TODO.md`;

## type, enum, function consolidation (DONE)

2. migrate all interfaces within `@core` into appropriate `@_types` files.
3. migrate enums and helper functions:
  * put functions into `@core_[s|i]/helpers/functions.ts`
  * put enums into `@core_[s|i]/helpers/enums.ts`

## tests

4. more precision in `@tests/` (fewer tests overall);
5. integrate benchmarks in the test suite;
6. threshold testing with `--complexity [1-10]`:
  * thresholds break the suite down into categories (e.g. semantic, semantic+benchmarks);
  * `1` - requires `--select`, precision test;
  * default `5` (suite without benchmarks);
  * categories: logic, math, semantic, code;
    * TBD: compound categories (semantic + logic, math + code, etc.);
    * TBD: audio and visual categories, after capability is developed;
7. add `--select` flag to select a test/benchmark;
8. ensure 100% coverage;

## docs

9. fill the `docs/` folder with the flow of research, what has been discovered, discarded, theories proven and disproven.
  * use comments that exist in the code, as they contain some of the research flow;
  * remove docs-bound portions of the comments after adding them to the docs;

## cleaning

10. remove all "PHASE X" and other planning stage noise.
11. remove big separators that distinguish file sections:
  * use a simple `// INFO: ...` instead;
12. JSdocs and multiline comments only where necessary:
  * JSDocs should be strict and to the point;
