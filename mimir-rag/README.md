## mimir-rag

Utility CLI + API that ingests **documentation (MDX) and codebases** into Supabase using **contextual RAG** and exposes OpenAI-compatible chat completions, MCP endpoints, and ingestion endpoints. It currently supports **TypeScript** and **Python** code, and is designed to be easily extensible to additional languages. Perfect for making your entire codebase and documentation queryable by AI assistants with rich contextual understanding.

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
- **Supabase**: `MIMIR_SUPABASE_URL` (required), `MIMIR_SUPABASE_SERVICE_ROLE_KEY` (required), `MIMIR_SUPABASE_TABLE` (optional, default: "docs")
- **GitHub** (language-agnostic code + docs ingestion): 
  - `MIMIR_GITHUB_URL` - Main repository URL (fallback if separate repos not set)
  - `MIMIR_GITHUB_CODE_URL` - Separate repository for code (TypeScript, Python, etc.) (optional, backward compatible)
  - `MIMIR_GITHUB_DOCS_URL` - Separate repository for MDX documentation (optional, backward compatible)
  - `MIMIR_GITHUB_TOKEN`, `MIMIR_GITHUB_DIRECTORY`, `MIMIR_GITHUB_BRANCH`
  - `MIMIR_GITHUB_CODE_DIRECTORY`, `MIMIR_GITHUB_CODE_INCLUDE_DIRECTORIES` - Code repo specific settings
  - `MIMIR_GITHUB_DOCS_DIRECTORY`, `MIMIR_GITHUB_DOCS_INCLUDE_DIRECTORIES` - Docs repo specific settings
  - **Multiple Repositories**: Use numbered variables for multiple repos:
    - `MIMIR_GITHUB_CODE_REPO_1_URL`, `MIMIR_GITHUB_CODE_REPO_1_DIRECTORY`, etc.
    - `MIMIR_GITHUB_DOCS_REPO_1_URL`, `MIMIR_GITHUB_DOCS_REPO_1_BASE_URL`, etc.
  - See [Configuration Documentation](../mimir-docs/app/configuration) for complete details
- **Parser**: 
  - `MIMIR_EXTRACT_VARIABLES` - Extract top-level variables (default: false)
  - `MIMIR_EXTRACT_METHODS` - Extract class methods (default: true)
  - `MIMIR_EXCLUDE_PATTERNS` - Comma-separated patterns to exclude (e.g., "*.test.ts,test/,__tests__/")
- **LLM Embedding**: `MIMIR_LLM_EMBEDDING_PROVIDER`, `MIMIR_LLM_EMBEDDING_MODEL`, `MIMIR_LLM_EMBEDDING_API_KEY`
- **LLM Chat**: `MIMIR_LLM_CHAT_PROVIDER`, `MIMIR_LLM_CHAT_MODEL`, `MIMIR_LLM_CHAT_API_KEY`, `MIMIR_LLM_CHAT_TEMPERATURE`
- **Documentation**: `MIMIR_DOCS_BASE_URL`, `MIMIR_DOCS_CONTENT_PATH` - For generating docs URLs

### LLM Providers

`MIMIR_LLM_EMBEDDING_PROVIDER` supports `openai`, `google`, and `mistral`. The chat provider (`MIMIR_LLM_CHAT_PROVIDER`) can be set independently to `openai`, `google`, `anthropic`, or `mistral`, letting you mix providers (e.g., OpenAI embeddings with Mistral chat completions). Provide the appropriate API key/endpoint per provider. Anthropic currently lacks an embeddings API, so embeddings still need to come from OpenAI, Google, or Mistral.

### Repository Configuration

You can configure single or multiple repositories for code and MDX documentation. Code repositories can contain TypeScript, Python, or any other supported language – the ingestion pipeline is language-agnostic at the repository level.

#### Single Repository (Backward Compatible)

```bash
# Main repository (fallback)
MIMIR_GITHUB_URL=https://github.com/user/main-repo

# Separate code repository (TypeScript, Python, etc.)
MIMIR_GITHUB_CODE_URL=https://github.com/user/code-repo
MIMIR_GITHUB_CODE_DIRECTORY=src
MIMIR_GITHUB_CODE_INCLUDE_DIRECTORIES=src,lib

# Separate documentation repository (MD/MDX)
MIMIR_GITHUB_DOCS_URL=https://github.com/user/docs-repo
MIMIR_GITHUB_DOCS_DIRECTORY=docs
MIMIR_GITHUB_DOCS_INCLUDE_DIRECTORIES=docs,guides
```

#### Multiple Repositories

Use numbered environment variables to configure multiple repositories with per-repo settings:

```bash
# ============================================
# MULTIPLE CODE REPOSITORIES
# ============================================
# Code Repository 1
MIMIR_GITHUB_CODE_REPO_1_URL=https://github.com/user/repo1
MIMIR_GITHUB_CODE_REPO_1_DIRECTORY=src
MIMIR_GITHUB_CODE_REPO_1_INCLUDE_DIRECTORIES=src,lib
MIMIR_GITHUB_CODE_REPO_1_EXCLUDE_PATTERNS=*.test.ts,test/

# Code Repository 2
MIMIR_GITHUB_CODE_REPO_2_URL=https://github.com/user/repo2
MIMIR_GITHUB_CODE_REPO_2_DIRECTORY=packages

# ============================================
# MULTIPLE DOCS REPOSITORIES
# ============================================
# Docs Repository 1
MIMIR_GITHUB_DOCS_REPO_1_URL=https://github.com/user/docs1
MIMIR_GITHUB_DOCS_REPO_1_DIRECTORY=docs
MIMIR_GITHUB_DOCS_REPO_1_BASE_URL=https://docs.example.com
MIMIR_GITHUB_DOCS_REPO_1_CONTENT_PATH=content/docs

# Docs Repository 2
MIMIR_GITHUB_DOCS_REPO_2_URL=https://github.com/user/docs2
MIMIR_GITHUB_DOCS_REPO_2_BASE_URL=https://docs2.example.com
```

**For complete configuration documentation including all environment variables, deployment guides, and examples, see the [Mimir Documentation Site](../mimir-docs/README.md).**

### Parser Configuration

Control what gets extracted from your codebase:

- **`MIMIR_EXTRACT_VARIABLES`** (default: `false`): Extract top-level variable declarations. Note: Exported `const` functions are always extracted regardless of this setting.
- **`MIMIR_EXTRACT_METHODS`** (default: `true`): Extract class methods as separate entities.
- **`MIMIR_EXCLUDE_PATTERNS`**: Comma-separated list of patterns to exclude:
  - File patterns: `*.test.ts`, `*.spec.ts`
  - Directory patterns: `test/`, `__tests__/`, `tests/`
  
  Example: `MIMIR_EXCLUDE_PATTERNS=*.test.ts,*.spec.ts,test/,__tests__/,tests/`

### Code Entity Extraction (TypeScript, Python, and more)

mimir-rag automatically extracts and indexes language-specific code entities from your codebase:

- **TypeScript**:
  - Functions: `export function myFunction() {}`
  - Exported const functions: `export const myFunction = () => {}` (always extracted)
  - Classes: `export class MyClass {}`
  - Interfaces: `export interface MyInterface {}`
  - Types: `export type MyType = ...`
  - Enums: `export enum MyEnum {}`
  - Methods: class methods (if `MIMIR_EXTRACT_METHODS=true`)

- **Python**:
  - Top-level functions
  - Classes
  - Methods (functions inside classes)
  - Module-level context entity for each file

Each entity is stored as a separate chunk with **rich contextual information**:
- Full code snippet
- **Contextual RAG**: Surrounding file content, imports, and parent/module/class context
- Language-native doc comments (e.g., TypeScript JSDoc, Python docstrings)
- Parameters and return types when available
- Line numbers for source linking
- GitHub URL for direct code access

This contextual RAG approach allows the AI to understand not just the entity itself, but also how it fits into the larger codebase—what it imports, what it's part of, and how it's used. This enables more accurate and contextually-aware answers with direct links to source code.

## API Endpoints

### POST /v1/chat/completions

OpenAI-compatible chat completions endpoint that queries your documentation and codebase using contextual RAG. Requires API key authentication.

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

**Note:** This endpoint performs contextual RAG - semantic search using OpenAI embeddings that returns document chunks with their full content and surrounding context. The calling AI assistant can then synthesize answers from the retrieved content, avoiding additional LLM API calls on the server side.

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
