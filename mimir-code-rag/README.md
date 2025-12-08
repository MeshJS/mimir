# mimir-code-rag

Auto-documentation RAG for TypeScript projects. Extracts code entities (functions, classes, interfaces, types, enums) via AST parsing, generates contextual descriptions using LLM, and stores embeddings for semantic search.

## Features

- **AST-based Entity Extraction**: Uses TypeScript Compiler API to parse and extract:
  - Functions (including arrow functions)
  - Classes and their methods
  - Interfaces
  - Type aliases
  - Enums
  
- **Intelligent Context Generation**: LLM generates concise descriptions for each entity explaining:
  - Purpose and role in the codebase
  - Parameters, return types, and properties
  - Dependencies and relationships

- **Efficient Re-embedding**: Checksum-based deduplication ensures only changed code gets re-embedded:
  - Unchanged entities are skipped
  - Moved entities are updated without re-embedding
  - Only new/modified entities trigger LLM + embedding calls

- **Multiple LLM Providers**: Supports OpenAI, Google, Anthropic, and Mistral

## Quick Start

### 1. Install Dependencies

```bash
cd mimir-code-rag
npm install
```

### 2. Set Up Database

**Option A: Using Makefile (recommended)**
```bash
# Set DATABASE_URL in your environment or .env file
export DATABASE_URL="postgresql://postgres:password@db.your-project.supabase.co:5432/postgres"
make setup-db
```

**Option B: Using Docker (automatic)**
The Docker container will automatically run the setup SQL on startup if `DATABASE_URL` is set.

**Option C: Manual**
Copy the contents of `src/supabase/setup.sql` and run in Supabase SQL Editor.

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

Required environment variables:
- `API_KEY` - API key for the service
- `SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `GITHUB_URL` - GitHub repository URL to index
- `OPENAI_API_KEY` (or other provider key) - LLM API key

### 4. Run Ingestion

```bash
npm run ingest
```

### 5. Start Server (Optional)

```bash
npm run start
# or
make server
```

The server provides:
- `GET /health` - Health check endpoint
- `POST /ingest` - Trigger ingestion pipeline (requires API key)
- `POST /v1/chat/completions` - OpenAI-compatible chat endpoint (requires API key)

## Configuration

### GitHub Source

```env
GITHUB_URL=https://github.com/owner/repo
GITHUB_DIRECTORY=packages     # Optional: specific directory to index (e.g., "packages")
GITHUB_BRANCH=main            # Optional: branch (defaults to main)
GITHUB_TOKEN=ghp_xxx          # Optional: for private repos
GITHUB_INCLUDE_DIRECTORIES=packages/utils,packages/core  # Optional: only include these subdirectories
```

**Example:** If you have a `packages` folder and only want to index `packages/utils` and `packages/core`:
```env
GITHUB_DIRECTORY=packages
GITHUB_INCLUDE_DIRECTORIES=packages/utils,packages/core
```

### Parser Options

```env
EXTRACT_VARIABLES=false       # Extract top-level const/let declarations
EXTRACT_METHODS=true          # Extract class methods as separate entities
EXCLUDE_PATTERNS=*.test.ts,*.spec.ts  # Patterns to exclude
```

### LLM Providers

**OpenAI (default)**
```env
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
CHAT_PROVIDER=openai
CHAT_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-xxx
```

**Google**
```env
EMBEDDING_PROVIDER=google
EMBEDDING_MODEL=text-embedding-004
CHAT_PROVIDER=google
CHAT_MODEL=gemini-1.5-flash
GOOGLE_API_KEY=xxx
```

**Anthropic** (chat only)
```env
CHAT_PROVIDER=anthropic
CHAT_MODEL=claude-3-haiku-20240307
ANTHROPIC_API_KEY=xxx
```

**Mistral**
```env
EMBEDDING_PROVIDER=mistral
EMBEDDING_MODEL=mistral-embed
CHAT_PROVIDER=mistral
CHAT_MODEL=mistral-small-latest
MISTRAL_API_KEY=xxx
```

## How It Works

### 1. File Discovery
Downloads all `.ts` and `.tsx` files from the configured GitHub repository, excluding `.d.ts` declaration files.

### 2. AST Parsing
Uses TypeScript Compiler API to extract code entities:
- Preserves qualified names (e.g., `ClassName.methodName`)
- Extracts JSDoc comments
- Captures parameter and return type information

### 3. Chunking
Enforces token limits per entity:
- Large entities are split with signature headers for context
- Checksums are calculated from code content only

### 4. Deduplication
Compares checksums with existing database entries:
- **Unchanged**: Same checksum at same location → skip
- **Moved**: Same checksum at different location → update location only
- **New**: New checksum → generate context + embedding

### 5. Context Generation
LLM generates 100-200 token descriptions for each entity explaining its purpose and role.

### 6. Embedding
Batch embeds `{contextHeader}\n---\n{code}` for each entity.

### 7. Storage
Upserts to Supabase with vector embeddings for semantic search.

## Database Schema

```sql
CREATE TABLE code_chunks (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,           -- Original code
    contextual_text TEXT NOT NULL,   -- Context + code
    embedding vector(1536),          -- Embedding vector
    filepath TEXT NOT NULL,          -- Source file path
    chunk_id INTEGER NOT NULL,       -- Index within file
    chunk_title TEXT NOT NULL,       -- Qualified entity name
    checksum TEXT NOT NULL,          -- SHA-256 of code
    entity_type TEXT NOT NULL,       -- function/class/interface/etc
    github_url TEXT,                 -- Link to source
    start_line INTEGER,              -- Start line in file
    end_line INTEGER,                -- End line in file
    UNIQUE (filepath, chunk_id)
);
```

## Scripts

```bash
npm run ingest          # Run ingestion pipeline
npm run start           # Start the server
npm run dev             # Start server in development mode
npm run generate-apikey # Generate a new API key
npm run build           # Build TypeScript
```

## API Endpoints

### Health Check
```bash
GET /health
# Returns: { "status": "ok", "ingestionBusy": false }
```

### Trigger Ingestion
```bash
POST /ingest
Headers: x-api-key: <your-api-key>
# Returns: { "status": "ok", "trigger": "manual-request", "durationMs": 1234, "stats": {...} }
```

### Chat Completions (OpenAI-compatible)
```bash
POST /v1/chat/completions
Headers: 
  x-api-key: <your-api-key>
  Content-Type: application/json
Body:
{
  "model": "mimir-code-rag",
  "messages": [
    { "role": "user", "content": "How does the parseTypescriptFile function work?" }
  ],
  "stream": false,
  "matchCount": 10,
  "similarityThreshold": 0.5
}
```

## Docker Usage

### Build and Run

```bash
# Build the Docker image
make docker-build

# Run ingestion in Docker (automatically sets up database)
make docker-run

# Or build and run in one command
make docker-run-build
```

The Docker container will:
1. Automatically run `setup.sql` to create tables if `DATABASE_URL` is set
2. Load environment variables from `.env` file
3. Start the server (listens on port 3001 by default)

To run ingestion in Docker, override the CMD:
```bash
docker run --rm -v $(pwd)/.env:/app/.env mimir-code-rag:local node dist/cli/ingest.js
```

### Environment Variables for Docker

Add to your `.env` file:
```env
# For automatic database setup
DATABASE_URL=postgresql://postgres:password@db.your-project.supabase.co:5432/postgres
# OR
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_DB_PASSWORD=your_database_password
```

## Makefile Commands

```bash
make setup-db          # Run database setup SQL
make server            # Start the server (runs setup-db first)
make ingest            # Run ingestion pipeline
make clean             # Remove dist and tmp directories
make docker-build       # Build Docker image
make docker-run        # Run Docker container
make docker-run-build   # Build and run Docker container
```

## Architecture

```
src/
├── cli/              # Command-line tools
├── config/           # Configuration types and loading
├── github/           # GitHub URL parsing utilities
├── ingest/           # Core ingestion pipeline
│   ├── typescript.ts     # File discovery
│   ├── astParser.ts      # AST parsing
│   ├── entityChunker.ts  # Chunking logic
│   └── pipeline.ts       # Main orchestration
├── llm/              # LLM providers and context generation
├── supabase/         # Database client
└── utils/            # Shared utilities
```

## License

ISC

