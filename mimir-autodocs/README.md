# mimir-autodocs

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
cd mimir-autodocs
npm install
```

### 2. Set Up Database

Run the SQL setup script in your Supabase project:

```bash
# Copy the contents of src/supabase/setup.sql and run in Supabase SQL Editor
```

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

## Configuration

### GitHub Source

```env
GITHUB_URL=https://github.com/owner/repo
GITHUB_DIRECTORY=src           # Optional: specific directory to index
GITHUB_BRANCH=main            # Optional: branch (defaults to main)
GITHUB_TOKEN=ghp_xxx          # Optional: for private repos
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
CREATE TABLE autodocs_chunks (
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
npm run generate-apikey # Generate a new API key
npm run build           # Build TypeScript
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

