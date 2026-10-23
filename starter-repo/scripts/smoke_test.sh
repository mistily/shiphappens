#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")/.."
python -m uvicorn run:app --host 0.0.0.0 --port 8000 --reload
