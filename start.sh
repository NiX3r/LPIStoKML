#!/usr/bin/env bash
set -e

WORKDIR="/srv/LPIStoKML"
VENV="$WORKDIR/.venv"

cd "$WORKDIR"

# Pull latest code (hard reset to remote to avoid divergence blocking startup)
git fetch origin
git reset --hard origin/main

# Create venv if missing
if [ ! -d "$VENV" ]; then
    python3 -m venv "$VENV"
fi

# Install/update dependencies
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet -r "$WORKDIR/requirements.txt"

# Run the app
exec "$VENV/bin/python" "$WORKDIR/app.py"
