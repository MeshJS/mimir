.PHONY: setup-db baseline-db server ingest clean docker-build docker-run docker-run-build

export

DB_URL ?= $(or $(DATABASE_URL),$(shell echo $$DATABASE_URL))
DB_PASSWORD ?= $(or $(PGPASSWORD),$(shell echo $$PGPASSWORD))
PSQL ?= psql
IMAGE_NAME ?= mimir-rag:local
CONFIG_PATH ?= .env
CONFIG_ABS := $(abspath $(CONFIG_PATH))
PORT ?= 3000

setup-db:
	@if [ -f "$(CONFIG_PATH)" ]; then \
		set -a; \
		. "$(CONFIG_PATH)"; \
		set +a; \
	fi; \
	DB_URL_FINAL=""; \
	if [ -n "$$MIMIR_DATABASE_URL" ]; then \
		DB_URL_FINAL="$$MIMIR_DATABASE_URL"; \
	elif [ -n "$$DATABASE_URL" ]; then \
		DB_URL_FINAL="$$DATABASE_URL"; \
	elif [ -n "$(DB_URL)" ]; then \
		DB_URL_FINAL="$(DB_URL)"; \
	fi; \
	if [ -z "$$DB_URL_FINAL" ]; then \
		echo "Error: set MIMIR_DATABASE_URL or DATABASE_URL in $(CONFIG_PATH), or pass DB_URL=..."; \
		exit 1; \
	fi; \
	export DATABASE_URL="$$DB_URL_FINAL"; \
	if ! npx prisma migrate deploy 2>&1; then \
		echo ""; \
		echo "Migration failed. If your database already has a schema from the old setup:"; \
		echo "  1. Run 'make baseline-db' to mark the migration as applied, OR"; \
		echo "  2. Run 'npm run prisma:push' for development (doesn't track migrations)"; \
		exit 1; \
	fi

baseline-db:
	@if [ -f "$(CONFIG_PATH)" ]; then \
		set -a; \
		. "$(CONFIG_PATH)"; \
		set +a; \
	fi; \
	DB_URL_FINAL=""; \
	if [ -n "$$MIMIR_DATABASE_URL" ]; then \
		DB_URL_FINAL="$$MIMIR_DATABASE_URL"; \
	elif [ -n "$$DATABASE_URL" ]; then \
		DB_URL_FINAL="$$DATABASE_URL"; \
	elif [ -n "$(DB_URL)" ]; then \
		DB_URL_FINAL="$(DB_URL)"; \
	fi; \
	if [ -z "$$DB_URL_FINAL" ]; then \
		echo "Error: set MIMIR_DATABASE_URL or DATABASE_URL in $(CONFIG_PATH)"; \
		exit 1; \
	fi; \
	export DATABASE_URL="$$DB_URL_FINAL"; \
	echo "Baselining existing database schema (marking migration as applied)..."; \
	npx prisma migrate resolve --applied 0_init && echo "Baseline complete! You can now run 'make setup-db' or 'make server'." || echo "Note: Migration may already be marked as applied."

server:
	@if [ -f "$(CONFIG_PATH)" ]; then \
		set -a; \
		. "$(CONFIG_PATH)"; \
		set +a; \
	fi; \
	npm run server

ingest:
	npm run ingest:cli -- --config .env

clean:
	rm -rf dist tmp

docker-build:
	docker build -t $(IMAGE_NAME) .

docker-run:
	@if [ ! -f "$(CONFIG_ABS)" ]; then \
		echo "Error: config file '$(CONFIG_PATH)' not found. Pass CONFIG_PATH=... to point at a valid file."; \
		exit 1; \
	fi
	@echo "Starting Docker container with config from $(CONFIG_PATH)..."
	@docker run --rm \
		-p $(PORT):$(PORT) \
		-v $(CONFIG_ABS):/app/.env:ro \
		$(IMAGE_NAME)

docker-run-build: docker-build docker-run
