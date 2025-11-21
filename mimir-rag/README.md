# mimir-rag

Utility CLI + API that ingests docs into Supabase and exposes `/ask` + `/ingest` endpoints.

## Local workflow

1. Copy `.env.example` to `.env` and fill in the Supabase, GitHub, and LLM variables. `MIMIR_SERVER_API_KEY` is the shared secret every HTTP call must send in the `x-api-key` header (or `Authorization: Bearer <key>`). Generate a random key however you prefer, e.g. `openssl rand -base64 32`.
2. Bootstrap the database schema (runs `psql src/supabase/setup.sql`):

   ```bash
   make setup-db DB_URL=postgresql://user@host:5432/db DB_PASSWORD=secret
   ```

3. Start the API (automatically re-runs `setup-db` beforehand):

   ```bash
   make server
   ```

4. Kick off ingestion on demand:

   ```bash
   make ingest
   ```

Need to point at a different env file? Pass `MIMIR_ENV_PATH=/path/to/.env` or `npm run ingest:cli -- --env /path/to/.env`.

## Docker workflow

The repository includes a Node 20–based image for CI/CD and for developers who prefer not to install Node locally.

```bash
make docker-build IMAGE_NAME=mimir-rag:local
make docker-run IMAGE_NAME=mimir-rag:local \
  ENV_FILE=./.env \
  DB_URL=postgresql://user@host:5432/db \
  DB_PASSWORD=secret \
  PORT=3000
```

`docker-run` reads the variables in `ENV_FILE` via `--env-file`, forwards the chosen port, and passes any database credentials so the container can reach Supabase.
When `DATABASE_URL` (or `DB_URL`) is provided, the container’s entrypoint automatically runs `src/supabase/setup.sql`
before starting the server, mirroring the local `make setup-db` behavior.

## LLM configuration

`MIMIR_LLM_EMBEDDING_PROVIDER` supports `openai`, `google`, and `mistral`. The chat provider (`MIMIR_LLM_CHAT_PROVIDER`) can be set independently to `openai`, `google`, `anthropic`, or `mistral`, letting you mix providers (e.g., OpenAI embeddings with Mistral chat completions). Provide the appropriate API key + base URL per provider via the other `MIMIR_LLM_*` variables; Anthropic’s API version can be overridden via `ANTHROPIC_API_VERSION`. Anthropic currently lacks an embeddings API, so embeddings still need to come from OpenAI, Google, or Mistral.
