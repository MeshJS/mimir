.PHONY: setup-db server ingest clean

DB_URL ?= $(DATABASE_URL)
DB_PASSWORD ?= $(PGPASSWORD)
PSQL ?= psql
SETUP_SQL := src/supabase/setup.sql

setup-db:
	@if [ -z "$(strip $(DB_URL))" ]; then \
		echo "Error: set DATABASE_URL (or pass DB_URL=...) so the schema can be bootstrapped."; \
		exit 1; \
	fi
	@if [ -z "$(strip $(DB_PASSWORD))" ]; then \
		$(PSQL) "$(DB_URL)" -f $(SETUP_SQL); \
	else \
		PGPASSWORD="$(DB_PASSWORD)" $(PSQL) "$(DB_URL)" -f $(SETUP_SQL); \
	fi

server: setup-db
	npm run server

ingest:
	npm run ingest:cli -- --config mimir.config.json

clean:
	rm -rf dist tmp
