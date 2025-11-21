.PHONY: setup-db server ingest clean docker-build docker-run

DB_URL ?= $(DATABASE_URL)
DB_PASSWORD ?= $(PGPASSWORD)
PSQL ?= psql
SETUP_SQL := src/supabase/setup.sql
IMAGE_NAME ?= mimir-rag:local
ENV_FILE ?= .env
ENV_FILE_ABS := $(abspath $(ENV_FILE))
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
	npm run ingest:cli

clean:
	rm -rf dist tmp

docker-build:
	docker build -t $(IMAGE_NAME) .

docker-run: docker-build
	@if [ ! -f "$(ENV_FILE_ABS)" ]; then \
		echo "Error: env file '$(ENV_FILE)' not found. Pass ENV_FILE=... to point at a valid file."; \
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
		--env-file $(ENV_FILE_ABS) \
		$$DOCKER_ENV_ARGS \
		-e PORT=$(PORT) \
		-p $(PORT):$(PORT) \
		$(IMAGE_NAME)
