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

# Everything runs from main, called on the last line: a download cut short by the network
# defines functions and runs nothing, instead of running half a script.
main() {
  if [[ "$(id -u)" == "0" ]]; then
    echo "Do not install Glassys as root. Run this as the user the agent should act as." >&2
    exit 1
  fi

  need_bin git
  need_bin node

  if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    local here
    here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$here/install.mjs" ]]; then
      exec node "$here/install.mjs" "$@"
    fi
  fi

  local dest="${GLASSYS_DIR:-$PWD/glassys}"
  local repo="${GLASSYS_REPO:-https://github.com/KN990x/Glassys.git}"
  if [[ ! -f "$dest/scripts/install.mjs" ]]; then
    git clone "$repo" "$dest"
  fi
  exec node "$dest/scripts/install.mjs" "$@"
}

main "$@"
