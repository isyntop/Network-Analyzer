#!/bin/bash
# 兼容原入口；具体发布步骤见 README。
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$SCRIPT_DIR/release.py" "$@"
