#!/usr/bin/env bash
# Starts inbill on this computer against a LOCAL Supabase, so nothing touches the real site or its database.
# Usage: scripts/local-up.sh        (then open http://localhost:5300)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${PORT:-5300}"

# 1. The Docker engine (Colima) and the local Supabase containers.
if ! docker info >/dev/null 2>&1; then command -v colima >/dev/null || { echo "Docker is not installed."; exit 1; }; colima start --cpu 4 --memory 3; fi
for c in supabase_db_supa supabase_auth_supa supabase_rest_supa supabase_kong_supa supabase_storage_supa; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || docker start "$c" >/dev/null 2>&1 || { echo "Could not start $c. See docs/LOCAL-TESTING.md."; exit 1; }
done
until curl -fs http://127.0.0.1:54321/auth/v1/health >/dev/null 2>&1; do sleep 2; done

# 2. Point the app at it. The app accepts only a localhost address here (see lib/supabase.ts).
printf 'INBILL_SUPABASE_URL=http://127.0.0.1:54321\nINBILL_SUPABASE_KEY=local\n' > .env.local
[ -d node_modules ] || npm ci --no-audit --no-fund

# 3. Run the app.
echo "inbill is starting at http://localhost:$PORT  (local database, no email, no payments)"
exec npx vinext dev --port "$PORT" --host 127.0.0.1
