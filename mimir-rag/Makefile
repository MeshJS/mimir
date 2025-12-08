.PHONY: setup-db server ingest clean docker-build docker-run docker-run-build

# Export environment variables to subprocesses
export

# Use environment variables (Make automatically imports them)
DB_URL ?= $(DATABASE_URL)
DB_PASSWORD ?= $(PGPASSWORD)
PSQL ?= psql
SETUP_SQL := src/supabase/setup.sql
IMAGE_NAME ?= mimir-rag:local
CONFIG_PATH ?= .env
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
