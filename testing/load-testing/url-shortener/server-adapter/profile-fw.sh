#!/usr/bin/env bash
# CPU-profiles the FULL execution process (dispatch, validation, worker context, factories) running the
# compiled artifacts, in one 1-CPU container under k6 (500 VUs, ~30 s), no Traefik.
#   bash profile-fw.sh <name> <exec-bundle-dir> [artifacts-file]
#   bash profile-fw.sh fw-base ../fluxify-worker/dist/exec-base artifacts.opt.json
# Output: $OUT/<name>.cpuprofile(.md) (default OUT=./profiles).
set -e
NAME=$1 EXEC=$2 ART=${3:-artifacts.json}
HERE="$(cd "$(dirname "$0")" && pwd)"; U="$(cd "$HERE/.." && pwd -W)"
OUT=${OUT:-$HERE/profiles}; mkdir -p "$OUT"; OUTW="$(cd "$OUT" && pwd -W)"; EXECW="$(cd "$HERE/$EXEC" && pwd -W)"
docker rm -f lt-prof >/dev/null 2>&1 || true
docker exec lt-urlshortener-valkey valkey-cli flushall >/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name lt-prof --network fluxify_net --cpus 1 --memory 1g -p 5710:5600 \
  -e ARTIFACTS=/h/dist/$ART -e EXECUTION_ENTRY=/e/executionProcess.js \
  -e CHILD_ARGS="--cpu-prof --cpu-prof-md --cpu-prof-name $NAME.cpuprofile --cpu-prof-dir /out" \
  -v "$U/fluxify-worker:/h:ro" -v "$EXECW:/e:ro" -v "$OUTW:/out" \
  --entrypoint /usr/local/bin/bun fluxify-worker:local /h/harness.ts >/dev/null
sleep 8
(cd "$HERE/.." && BASE_URL=http://fw.localhost:5710 k6 run -s 5s:500 -s 25s:500 -s 2s:0 \
  --summary-export="$OUTW/$NAME.summary.json" k6/stress.js > "$OUT/$NAME.k6.txt" 2>&1) || true
docker stop -t 30 lt-prof >/dev/null; docker rm lt-prof >/dev/null
grep http_reqs "$OUT/$NAME.k6.txt"
