#!/bin/sh
# Run the sidebar unit tests. Usage: sh ghostty/run-tests.sh
set -eu
cd "$(dirname "$0")"
PY="${GW_PYTHON:-python3}"
PYTHONPATH=lib exec "$PY" -m unittest discover -s tests -p 'test_*.py' -v
