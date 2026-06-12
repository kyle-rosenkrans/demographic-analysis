#!/bin/bash
# Double-click to build a single self-contained HTML version of the tool.
# Produces "KIPP Demographics (standalone).html" in this folder, which you can
# then double-click anytime (no server) or share.

cd "$(dirname "$0")" || exit 1

PY=""
for c in python3 /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done
if [ -z "$PY" ]; then
  echo "Python 3 not found. Run:  xcode-select --install   then try again."
  read -r -p "Press return to close."
  exit 1
fi

echo "Building the standalone file (this reads all data and may take a minute"
echo "the first time, while iCloud downloads the data files)…"
"$PY" build_standalone.py
echo ""
read -r -p "Done. Press return to close this window."
