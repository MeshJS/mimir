# mimir-rag

Utility CLI + API that ingests docs into Supabase and exposes `/ask` + `/ingest` endpoints.

## Local workflow

1. Copy `mimir.config.example.json` to `mimir.config.json` and fill in the Supabase + LLM details.
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
   make ingest CONFIG_PATH=mimir.config.json
   ```

## Docker workflow

The repository includes a Node 20–based image for CI/CD and for developers who prefer not to install Node locally.

```bash
make docker-build IMAGE_NAME=mimir-rag:local
make docker-run IMAGE_NAME=mimir-rag:local \
  CONFIG_PATH=./mimir.config.json \
  DB_URL=postgresql://user@host:5432/db \
  DB_PASSWORD=secret \
  PORT=3000
```

`docker-run` binds your local config file into `/app/mimir.config.json`, forwards the chosen port, and passes any database credentials so the container can reach Supabase.
When `DATABASE_URL` (or `DB_URL`) is provided, the container’s entrypoint automatically runs `src/supabase/setup.sql`
before starting the server, mirroring the local `make setup-db` behavior.

## LLM configuration

`llm.embedding.provider` supports `openai`, `google`, and `mistral`. The chat provider (`llm.chat.provider`) can be set independently to `openai`, `google`, `anthropic`, or `mistral`, letting you mix providers (e.g., OpenAI embeddings with Mistral chat completions). Provide the appropriate API key/endpoint per provider; Anthropic’s API version can be overridden via `ANTHROPIC_API_VERSION`. Anthropic currently lacks an embeddings API, so embeddings still need to come from OpenAI, Google, or Mistral.
