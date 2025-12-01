# mimir-rag

Utility CLI + API that ingests docs into Supabase and exposes OpenAI-compatible chat completions, MCP endpoints, and ingestion endpoints.

## Local workflow

1. Copy `.env.example` to `.env` and fill in the Supabase + LLM details plus a `MIMIR_SERVER_API_KEY`, which every HTTP call must send in the `x-api-key` header (or `Authorization: Bearer <key>`). Run `npm run generate-apikey` any time you want the project to mint a new random key and write it into your `.env` file.
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
   npm run ingest:cli
   ```

   Or with a custom .env file:

   ```bash
   npm run ingest:cli -- --config /path/to/custom.env
   ```

## Docker workflow

The repository includes a Node 20–based image for CI/CD and for developers who prefer not to install Node locally.

```bash
make docker-build IMAGE_NAME=mimir-rag:local
make docker-run IMAGE_NAME=mimir-rag:local \
  CONFIG_PATH=./.env \
  DB_URL=postgresql://user@host:5432/db \
  DB_PASSWORD=secret \
  PORT=3000
```

`docker-run` binds your local `.env` file into `/app/.env`, forwards the chosen port, and passes any database credentials so the container can reach Supabase.
When `DATABASE_URL` (or `DB_URL`) is provided, the container's entrypoint automatically runs `src/supabase/setup.sql`
before starting the server, mirroring the local `make setup-db` behavior.

## Configuration

All configuration is managed through environment variables in the `.env` file. See [.env.example](.env.example) for all available options.

### Environment Variables

Key configuration variables include:

- **Server**: `MIMIR_SERVER_API_KEY` (required), `MIMIR_SERVER_GITHUB_WEBHOOK_SECRET`, `MIMIR_SERVER_FALLBACK_INGEST_INTERVAL_MINUTES`
- **Supabase**: `MIMIR_SUPABASE_URL` (required), `MIMIR_SUPABASE_SERVICE_ROLE_KEY` (required), `MIMIR_SUPABASE_TABLE`
- **GitHub**: `MIMIR_GITHUB_URL`, `MIMIR_GITHUB_TOKEN`, `MIMIR_GITHUB_DIRECTORY`, `MIMIR_GITHUB_BRANCH`
- **LLM Embedding**: `MIMIR_LLM_EMBEDDING_PROVIDER`, `MIMIR_LLM_EMBEDDING_MODEL`, `MIMIR_LLM_EMBEDDING_API_KEY`
- **LLM Chat**: `MIMIR_LLM_CHAT_PROVIDER`, `MIMIR_LLM_CHAT_MODEL`, `MIMIR_LLM_CHAT_API_KEY`, `MIMIR_LLM_CHAT_TEMPERATURE`

### LLM Providers

`MIMIR_LLM_EMBEDDING_PROVIDER` supports `openai`, `google`, and `mistral`. The chat provider (`MIMIR_LLM_CHAT_PROVIDER`) can be set independently to `openai`, `google`, `anthropic`, or `mistral`, letting you mix providers (e.g., OpenAI embeddings with Mistral chat completions). Provide the appropriate API key/endpoint per provider. Anthropic currently lacks an embeddings API, so embeddings still need to come from OpenAI, Google, or Mistral.

## API Endpoints

### POST /v1/chat/completions

OpenAI-compatible chat completions endpoint that queries your documentation with RAG. Requires API key authentication.

**Headers:**
- `x-api-key: <MIMIR_SERVER_API_KEY>` or `Authorization: Bearer <MIMIR_SERVER_API_KEY>`
- `Content-Type: application/json`

**Request body:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "How do I implement authentication?"
    }
  ],
  "matchCount": 10,
  "similarityThreshold": 0.2,
  "systemPrompt": "You are a helpful coding assistant",
  "stream": false
}
```

**Response:**
OpenAI-compatible chat completion response format with retrieved documentation context.

### POST /mcp/ask

Query your documentation via MCP (Model Context Protocol) without server API key authentication. This endpoint allows MCP clients to provide their own LLM credentials dynamically.

**Headers:**
- `Content-Type: application/json`

**Request body:**
```json
{
  "question": "How do I implement authentication?",
  "provider": "anthropic",
  "model": "claude-3-5-sonnet-20241022",
  "apiKey": "your-llm-api-key",
  "matchCount": 10,
  "similarityThreshold": 0.2,
  "systemPrompt": "You are a helpful coding assistant"
}
```

**Response:**
```json
{
  "status": "ok",
  "answer": "Based on the documentation...",
  "sources": [...]
}
```

**Note:** The `/mcp/ask` endpoint bypasses the `MIMIR_SERVER_API_KEY` authentication and allows clients to specify their own LLM provider, model, and API key. This is designed for use with the [mimir-mcp](../mimir-mcp) MCP server.

### POST /mcp/match

Semantic search endpoint that returns matching documentation chunks without generating an AI response. No authentication required.

**Headers:**
- `Content-Type: application/json`

**Request body:**
```json
{
  "question": "How do I implement authentication?",
  "matchCount": 10,
  "similarityThreshold": 0.2
}
```

**Response:**
```json
{
  "status": "ok",
  "matches": [
    {
      "title": "Authentication Guide",
      "url": "https://example.com/docs/auth",
      "similarity": 0.85
    }
  ]
}
```

**Note:** This endpoint is faster than `/mcp/ask` since it only performs semantic search without LLM inference. Useful for discovering relevant documentation.

### POST /ingest

Trigger documentation ingestion manually.

**Headers:**
- `x-api-key: <MIMIR_SERVER_API_KEY>` or `Authorization: Bearer <MIMIR_SERVER_API_KEY>`

**Response:**
```json
{
  "status": "ok",
  "trigger": "manual-request",
  "durationMs": 5432,
  "stats": {...}
}
```

### POST /webhook/github

GitHub webhook endpoint for automatic ingestion on repository changes.

**Headers:**
- `x-hub-signature-256: <github-signature>`
- `x-github-event: <event-type>`

Requires `MIMIR_SERVER_GITHUB_WEBHOOK_SECRET` to be configured.

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "ingestionBusy": false
}
```
