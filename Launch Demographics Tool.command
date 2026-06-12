#!/bin/bash
# Double-click this file to start the KIPP demographics tool.
# It launches the local server and opens the tool in your browser.
# Keep the Terminal window that appears open while you use the tool;
# close it (or press Ctrl+C) when you're done.

cd "$(dirname "$0")" || exit 1

# Find a Python 3 interpreter.
PY=""
for c in python3 /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$c"; break; fi
done

if [ -z "$PY" ]; then
  echo "Python 3 was not found."
  echo "Install Apple's command line tools by running:  xcode-select --install"
  echo "Then double-click this launcher again."
  read -r -p "Press return to close."
  exit 1
fi

echo "Starting the KIPP Demographics tool…"
exec "$PY" web/serve.py 8765
