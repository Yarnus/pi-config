#!/bin/sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
	printf '%s\n' "Node is required. Run mise install, then mise exec -- ./setup-pi.sh" >&2
	exit 1
fi
exec node "$repo_root/scripts/setup-pi.mjs" "$@"
