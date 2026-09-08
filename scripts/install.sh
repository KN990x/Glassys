#!/usr/bin/env bash
# One-command host install. Not an npm publish.
# From a clone: bash scripts/install.sh
# Piped: curl -fsSL https://raw.githubusercontent.com/KN990x/Glassys/main/scripts/install.sh | bash
set -euo pipefail

need_bin() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Glassys install needs $1 on PATH." >&2
    exit 1
  fi
}

need_bin git
need_bin node

if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$here/install.mjs" ]]; then
    exec node "$here/install.mjs" "$@"
  fi
fi

DEST="${GLASSYS_DIR:-$PWD/glassys}"
REPO="${GLASSYS_REPO:-https://github.com/KN990x/Glassys.git}"
if [[ ! -f "$DEST/scripts/install.mjs" ]]; then
  git clone "$REPO" "$DEST"
fi
exec node "$DEST/scripts/install.mjs" "$@"
