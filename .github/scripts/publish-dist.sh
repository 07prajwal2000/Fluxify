#!/usr/bin/env bash
# Builds one package and publishes its dist/ to npm, unless that version is already there.
set -euo pipefail

pkg="$1"
name=$(node -p "require('./$pkg/package.json').name")
version=$(node -p "require('./$pkg/package.json').version")

if npm view "$name@$version" version >/dev/null 2>&1; then
  msg="$name changed but $version is already on npm: bump it (bun run version in $pkg) to release"
  echo "::notice title=Nothing published::$msg"
  echo "$msg" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
  exit 0
fi

bun run --cwd "$pkg" build
cd "$pkg/dist"
npm publish --provenance --access public
