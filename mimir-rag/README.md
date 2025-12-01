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

Semantic search endpoint via MCP (Model Context Protocol) that returns matching documentation chunks with content. No authentication required. Designed for use with the [mimir-mcp](../mimir-mcp) MCP server.

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
  "count": 2,
  "matches": [
    {
      "chunkTitle": "Authentication Guide - Getting Started",
      "chunkContent": "To implement authentication in your application...",
      "similarity": 0.85,
      "githubUrl": "https://github.com/user/repo/blob/main/docs/auth.md#L10-L25",
      "docsUrl": "https://docs.example.com/auth"
    }
  ]
}
```

**Note:** This endpoint performs semantic search using OpenAI embeddings and returns document chunks with their full content. The calling AI assistant can then synthesize answers from the retrieved content, avoiding additional LLM API calls on the server side.

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
