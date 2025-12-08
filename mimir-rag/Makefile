.PHONY: setup-db server ingest clean docker-build docker-run docker-run-build

# Export environment variables to subprocesses
export

# Use environment variables - check both Make variable and environment variable
DB_URL ?= $(or $(DATABASE_URL),$(shell echo $$DATABASE_URL))
DB_PASSWORD ?= $(or $(PGPASSWORD),$(shell echo $$PGPASSWORD))
PSQL ?= psql
SETUP_SQL := src/supabase/setup.sql
IMAGE_NAME ?= mimir-rag:local
CONFIG_PATH ?= .env
CONFIG_ABS := $(abspath $(CONFIG_PATH))
PORT ?= 3000

setup-db:
	@if [ -z "$${DATABASE_URL:-$(DB_URL)}" ]; then \
		echo "Error: set DATABASE_URL (or pass DB_URL=...) so the schema can be bootstrapped."; \
		exit 1; \
	fi
	@DB_URL="$${DATABASE_URL:-$(DB_URL)}"; \
	DB_PASSWORD="$${PGPASSWORD:-$(DB_PASSWORD)}"; \
	if [ -z "$$DB_PASSWORD" ]; then \
		$(PSQL) "$$DB_URL" -f $(SETUP_SQL); \
	else \
		PGPASSWORD="$$DB_PASSWORD" $(PSQL) "$$DB_URL" -f $(SETUP_SQL); \
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
