# mimir-rag

Utility CLI + API that ingests docs into Supabase and exposes OpenAI-compatible chat completions, MCP endpoints, and ingestion endpoints.

## Quick Start

1. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase + LLM credentials
   ```

2. **Generate API key:**
   ```bash
   npm run generate-apikey
   ```

3. **Start the server:**
   ```bash
   make server
   ```

   The server automatically:
   - Loads your `.env` configuration
   - Bootstraps the database schema (if `DATABASE_URL` is set)
   - Starts the API on port 3000

4. **Trigger ingestion:**
   ```bash
   npm run ingest:cli
   ```

## Local Development

### Database Setup

The database schema is automatically initialized when you run `make server` if you provide database credentials in your `.env` file. You have two options:

**Option 1: Automatic (Recommended)**
Add your Supabase database password to `.env`:
```bash
MIMIR_SUPABASE_DB_PASSWORD=your_db_password
```
The system will automatically construct the `DATABASE_URL` from your `MIMIR_SUPABASE_URL`.

**Option 2: Manual DATABASE_URL**
Provide the full database URL in `.env`:
```bash
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
```

### Manual Database Setup

If you need to run the schema setup manually:
```bash
make setup-db DB_URL=postgresql://user@host:5432/db DB_PASSWORD=secret
```

## Docker Deployment

The repository includes a Node 20–based Alpine Linux image (~302MB) optimized for CI/CD and production deployments.

### One-Line Setup

**Build and run with your `.env` file:**
```bash
make docker-run-build
```

That's it! The container automatically:
- Loads all configuration from your `.env` file
- Sets up the database schema (no manual psql commands needed)
- Starts the server on port 3000

### Customization

**Use a different port:**
```bash
make docker-run-build PORT=8080
```

**Use a different config file:**
```bash
make docker-run-build CONFIG_PATH=.env.production
```

**Custom image name:**
```bash
make docker-run-build IMAGE_NAME=mimir:v1.0
```

### Separate Build and Run

If you prefer to build and run separately:

**Build:**
```bash
make docker-build
```

**Run:**
```bash
make docker-run
```

### Manual Docker Commands

**Build:**
```bash
docker build -t mimir-rag:local .
```

**Run:**
```bash
docker run --rm \
  -p 3000:3000 \
  -v $(pwd)/.env:/app/.env:ro \
  mimir-rag:local
```

### How It Works

The Docker container:
1. Mounts your `.env` file to `/app/.env` (read-only)
2. Automatically loads all environment variables from `.env`
3. Auto-constructs `DATABASE_URL` from `MIMIR_SUPABASE_URL` + `MIMIR_SUPABASE_DB_PASSWORD` (if not already set)
4. Runs the database schema setup SQL automatically
5. Starts the server

**No manual database setup required!** Just add your database password to `.env` and everything else is automatic.

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
