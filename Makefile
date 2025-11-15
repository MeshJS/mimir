.PHONY: setup-db server ingest clean docker-build docker-run

DB_URL ?= $(DATABASE_URL)
DB_PASSWORD ?= $(PGPASSWORD)
PSQL ?= psql
SETUP_SQL := src/supabase/setup.sql
IMAGE_NAME ?= mimir-rag:local
CONFIG_PATH ?= mimir.config.json
CONFIG_ABS := $(abspath $(CONFIG_PATH))
PORT ?= 3000

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

docker-build:
	docker build -t $(IMAGE_NAME) .

docker-run: docker-build
	@if [ ! -f "$(CONFIG_ABS)" ]; then \
		echo "Error: config file '$(CONFIG_PATH)' not found. Pass CONFIG_PATH=... to point at a valid file."; \
		exit 1; \
	fi
	@DOCKER_ENV_ARGS=""; \
	if [ -n "$(strip $(DB_URL))" ]; then \
		DOCKER_ENV_ARGS="$$DOCKER_ENV_ARGS -e DATABASE_URL=$(DB_URL)"; \
	fi; \
	if [ -n "$(strip $(DB_PASSWORD))" ]; then \
		DOCKER_ENV_ARGS="$$DOCKER_ENV_ARGS -e DB_PASSWORD=$(DB_PASSWORD)"; \
	fi; \
	set -x; \
	docker run --rm \
		$$DOCKER_ENV_ARGS \
		-e PORT=$(PORT) \
		-e MIMIR_CONFIG_PATH=/app/mimir.config.json \
		-p $(PORT):$(PORT) \
		-v $(CONFIG_ABS):/app/mimir.config.json:ro \
		$(IMAGE_NAME)
