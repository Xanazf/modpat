# TODO

## Extract primitives out of the existing code

1. Functions only (no classes, with exceptions);
2. Make objects/arrays where needed (e.g. `[g/c]pu_math`)
3. Self-contained, no ties to the `@core`

### List of primitives

* [x] SOA (can be a class) - `src/_lib/soa/` (GridIndex4D, BarnesHut4D);
* [x] Checksum (i.e. TMR, CRC-32) - `src/_lib/checksum/` (crc32, TMRFreeList);
* [x] Math (`gpu_`, `cpu_`) - `src/_lib/math/TensorMath.ts`;
* [x] Geometry (topology, positioning, etc.) - `src/_lib/geometry/Waves.ts`;
* [ ] Physics (e.g. particle life);
* [x] DuckDB (only primitives for interactions, e.g. `DatabaseContext`) - `src/_lib/persistence/DatabaseContext.ts`;
