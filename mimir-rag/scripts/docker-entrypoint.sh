#!/usr/bin/env bash
set -euo pipefail

SETUP_SQL="/app/src/supabase/setup.sql"

maybe_run_setup() {
    if [[ -z "${DATABASE_URL:-}" ]]; then
        echo "[entrypoint] DATABASE_URL not set; skipping schema bootstrap."
        return
    fi

    if [[ ! -f "$SETUP_SQL" ]]; then
        echo "[entrypoint] Setup SQL file not found at $SETUP_SQL; skipping."
        return
    fi

    echo "[entrypoint] Running Supabase setup SQL..."
    if [[ -n "${DB_PASSWORD:-}" ]]; then
        PGPASSWORD="$DB_PASSWORD" psql "$DATABASE_URL" -f "$SETUP_SQL"
    else
        psql "$DATABASE_URL" -f "$SETUP_SQL"
    fi
}

maybe_run_setup
exec "$@"
