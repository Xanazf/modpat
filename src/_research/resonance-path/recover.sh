#!/usr/bin/env bash
# Reproduce the resonance-path snapshot from git.
#
# Reads 18158be^ (the parent of the cutover commit that deleted the path) and
# writes the same three reference files already checked into snapshot/. Run from
# anywhere inside the repo; output is deterministic because the git ref is
# immutable.
set -euo pipefail

REF="18158be^"
OUT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/snapshot"
mkdir -p "$OUT"

# Traveler.ts at 18158be^: perceive entry wrappers + _perceiveCapturing +
# _perceiveWithSlot (the transfer-matrix resonance pipeline).
git show "${REF}:src/core/integral/Traveler.ts" | sed -n '2210,2780p' \
  > "${OUT}/perceiveCapturing_block.ts"

# Traveler.ts at 18158be^: discoverOperatorsByResonance + findDominantOperator.
git show "${REF}:src/core/integral/Traveler.ts" | sed -n '2903,3014p' \
  > "${OUT}/resonance_operator_helpers.ts"

# Waves.ts at 18158be^: ComplexArray + FFT primitives (complete file).
git show "${REF}:src/core/structural/properties/Waves.ts" \
  > "${OUT}/Waves.ts"

echo "recovered resonance-path snapshot from ${REF} to ${OUT}"
