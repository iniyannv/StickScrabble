#!/usr/bin/env bash
# Keep the bot running: restart it whenever it exits (crash, disconnect, bad network).
# Usage: BOT_NAME=stick scripts/run-forever.sh
cd "$(dirname "$0")/.."
while true; do
  npm start
  echo "$(date '+%H:%M:%S') bot exited with code $?, restarting in 5s"
  sleep 5
done
