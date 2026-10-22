#!/usr/bin/env bash
# CPU-profiles one server bundle in a 1-CPU container under k6 load (500 VUs, ~30 s), no Traefik.
#   bash profile.sh <name> <bundle-dir> <bundle-file> [artifacts-file]
#   bash profile.sh compiled-opt dist-compiled index-compiled.js artifacts.opt.json
# Output: $OUT/<name>.cpuprofile(.md) (default OUT=./profiles). Run from anywhere; needs the stack up
# (lt-urlshortener-postgres/valkey on fluxify_net) and ids in ../config/ids.txt.
set -e
NAME=$1 DIR=$2 FILE=$3 ART=${4:-artifacts.json}
HERE="$(cd "$(dirname "$0")" && pwd)"; U="$(cd "$HERE/.." && pwd -W)"
OUT=${OUT:-$HERE/profiles}; mkdir -p "$OUT"; OUTW="$(cd "$OUT" && pwd -W)"; HEREW="$(cd "$HERE" && pwd -W)"
docker rm -f lt-prof >/dev/null 2>&1 || true
docker exec lt-urlshortener-valkey valkey-cli flushall >/dev/null
MSYS_NO_PATHCONV=1 docker run -d --name lt-prof --network fluxify_net --cpus 1 --memory 1g -p 5710:3000 \
  -e NODE_ENV=production -e PORT=3000 -e ARTIFACTS=/h/dist/$ART -e BUNDLE=/c/$FILE \
  -e PG_URL=postgres://postgres:postgres@lt-urlshortener-postgres:5432/urlshortener \
  -e REDIS_URL=redis://lt-urlshortener-valkey:6379 \
  -v "$U/fluxify-worker:/h:ro" -v "$HEREW/$DIR:/c:ro" -v "$HEREW/prof.js:/w/prof.js:ro" -v "$OUTW:/out" -w /c \
  --entrypoint /usr/local/bin/bun fluxify-worker:local \
  --cpu-prof --cpu-prof-md --cpu-prof-name "$NAME.cpuprofile" --cpu-prof-dir /out /w/prof.js >/dev/null
sleep 5
(cd "$HERE/.." && BASE_URL=http://localhost:5710 k6 run -s 5s:500 -s 25s:500 -s 2s:0 \
  --summary-export="$OUTW/$NAME.summary.json" k6/stress.js > "$OUT/$NAME.k6.txt" 2>&1)
docker stop -t 30 lt-prof >/dev/null; docker rm lt-prof >/dev/null
grep http_reqs "$OUT/$NAME.k6.txt"
