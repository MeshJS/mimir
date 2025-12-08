#!/bin/sh
set -eu

SETUP_SQL="/app/src/supabase/setup.sql"
ENV_FILE="/app/.env"

# Load environment variables from .env file if it exists
if [ -f "$ENV_FILE" ]; then
    echo "[entrypoint] Loading environment from $ENV_FILE"
    set -a  # automatically export all variables
    . "$ENV_FILE"
    set +a
fi

# Extract database URL from Supabase URL if not already set
if [ -z "${DATABASE_URL:-}" ] && [ -n "${SUPABASE_URL:-}" ]; then
    # Try to construct DATABASE_URL from SUPABASE_URL
    # Supabase URL format: https://xxx.supabase.co
    # Database URL format: postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres
    SUPABASE_PROJECT=$(echo "$SUPABASE_URL" | sed -E 's|https://([^.]+)\.supabase\.co.*|\1|')
    if [ -n "${SUPABASE_DB_PASSWORD:-}" ]; then
        DATABASE_URL="postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.${SUPABASE_PROJECT}.supabase.co:5432/postgres"
        echo "[entrypoint] Constructed DATABASE_URL from SUPABASE_URL"
    fi
fi

maybe_run_setup() {
    if [ -z "${DATABASE_URL:-}" ]; then
        echo "[entrypoint] DATABASE_URL not set; skipping schema bootstrap."
        echo "[entrypoint] To enable automatic schema setup, set DATABASE_URL or SUPABASE_URL + SUPABASE_DB_PASSWORD in your .env file"
        return
    fi

    if [ ! -f "$SETUP_SQL" ]; then
        echo "[entrypoint] Setup SQL file not found at $SETUP_SQL; skipping."
        return
    fi

    echo "[entrypoint] Running Supabase setup SQL..."
    if psql "$DATABASE_URL" -f "$SETUP_SQL" 2>&1; then
        echo "[entrypoint] Database setup completed successfully"
    else
        echo "[entrypoint] Warning: Database setup failed (this is normal if schema already exists)"
    fi
}

maybe_run_setup
exec "$@"

