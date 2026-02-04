#!/bin/sh
set -eu

ENV_FILE="/app/.env"

if [ -f "$ENV_FILE" ]; then
    echo "[entrypoint] Loading environment from $ENV_FILE"
    set -a
    . "$ENV_FILE"
    set +a
fi

if [ -z "${DATABASE_URL:-}" ]; then
    if [ -n "${MIMIR_DATABASE_URL:-}" ]; then
        DATABASE_URL="${MIMIR_DATABASE_URL}"
        echo "[entrypoint] Using MIMIR_DATABASE_URL"
    fi
fi

if [ -n "${DATABASE_URL:-}" ]; then
    echo "[entrypoint] Running Prisma migrations..."
    export DATABASE_URL
    if npx prisma migrate deploy 2>&1; then
        echo "[entrypoint] Database migrations completed successfully"
    else
        echo "[entrypoint] Warning: Prisma migrate deploy failed, trying db push..."
        if npx prisma db push 2>&1; then
            echo "[entrypoint] Database schema pushed successfully"
        else
            echo "[entrypoint] Warning: Database setup failed (this is normal if schema already exists)"
        fi
    fi
else
    echo "[entrypoint] DATABASE_URL not set; skipping schema bootstrap."
    echo "[entrypoint] To enable automatic schema setup, set DATABASE_URL or MIMIR_DATABASE_URL in your .env file"
fi

exec "$@"
