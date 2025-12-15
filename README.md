## Mimir

A comprehensive **contextual RAG** (Retrieval Augmented Generation) system with MCP (Model Context Protocol) integration for both **documentation and codebases**. Mimir ingests documentation and source code (currently **TypeScript** and **Python**, with more languages planned) from GitHub repositories into a Supabase vector store and provides powerful querying capabilities through both REST API and MCP protocol. Unlike basic RAG, contextual RAG provides rich context around each code entity, including full file content, imports, and surrounding code.

## Projects

This repository contains two main components:

### [mimir-rag](./mimir-rag)

The core RAG server that handles ingestion and querying of both **documentation (MDX)** and **codebases** (TypeScript, Python, and easily extensible to more languages).

**Features:**
- Ingests documentation and source code from GitHub repositories into Supabase vector store
- Supports separate repositories for code and documentation
- Automatically extracts code entities (e.g., TypeScript: functions, classes, interfaces, exported const functions; Python: functions, classes, methods, module-level context)
- Supports multiple LLM providers (OpenAI, Anthropic, Google, Mistral)
- OpenAI-compatible chat completions endpoint (`/v1/chat/completions`)
- MCP endpoint for semantic document search (`/mcp/ask`)
- GitHub webhook integration for automatic ingestion on new code/MDX updates in repository
- Streaming responses support (OpenAI-compatible and custom SSE)
- Configurable chunking and embedding strategies
- Flexible parser configuration (exclude test files, control entity extraction)

**Quick Start:**
```bash
cd mimir-rag
cp .env.example .env
# Edit .env with your configuration
npm install
make setup-db DB_URL=postgresql://user@host:5432/db DB_PASSWORD=secret
make server
```

See the [mimir-rag README](./mimir-rag/README.md) for detailed configuration and usage.

### [mimir-mcp](./mimir-mcp)

MCP server that connects AI assistants (Claude Code, Cline, Claude Desktop) to the Mimir documentation system.

**Features:**
- Exposes `askDocs` tool for AI assistants via MCP protocol
- No configuration required - just install and use
- Fast semantic search without additional LLM calls
- Easy integration with VS Code and Claude Desktop

**Quick Start:**

For production (via npm):
```json
{
  "mcpServers": {
    "mimir": {
      "command": "npx",
      "args": ["-y", "@your-org/mimir-mcp"]
    }
  }
}
```

For local development:
```bash
cd mimir-mcp
npm install
npm run build
```

See the [mimir-mcp README](./mimir-mcp/README.md) for detailed setup instructions.

## Architecture

```
┌─────────────────────┐
│   GitHub Repo       │
│   (Documentation)   │
└──────────┬──────────┘
           │
           │ Webhook / Manual Ingest
           ▼
┌─────────────────────┐
│   mimir-rag         │
│   - Ingestion       │
│   - Chunking        │
│   - Embedding       │
│   - Vector Store    │
└──────────┬──────────┘
           │
           │ /mcp/ask endpoint
           ▼
┌─────────────────────┐       ┌─────────────────────┐
│   mimir-mcp         │◄──────┤  AI Assistant       │
│   (MCP Server)      │       │  - Claude Code      │
└─────────────────────┘       │  - VSCode           │
                              │  - Claude Desktop   │
                              └─────────────────────┘
```

## Workflow

1. **Ingestion Phase:**
   - mimir-rag fetches documentation (MDX) and code from configured GitHub repository(ies)
   - Code files are parsed to extract language-specific entities (TypeScript entities, Python functions/classes/methods, etc.)
   - **Contextual RAG**: Each entity is enriched with surrounding context - full file content, imports, parent classes, and related code
   - Documents are chunked into smaller segments with rich contextual information
   - Chunks are embedded using your chosen LLM provider
   - Embeddings are stored in Supabase vector database with source URLs pointing to GitHub

2. **Query Phase (via MCP):**
   - User asks a question in their AI assistant
   - AI assistant invokes the `askDocs` tool from mimir-mcp
   - mimir-mcp sends request to mimir-rag's `/mcp/ask` endpoint
   - mimir-rag retrieves relevant document chunks using vector similarity
   - Document chunks with content and metadata are returned to the AI assistant
   - AI assistant synthesizes an answer from the retrieved content

3. **Query Phase (via REST API):**
   - Direct HTTP POST to `/v1/chat/completions` endpoint (OpenAI-compatible)
   - Supports streaming and non-streaming responses
   - Works with Vercel AI SDK and other OpenAI-compatible clients
   - Returns OpenAI-formatted responses with answers and sources

## Use Cases

- **AI-Powered Code Assistant**: Let your AI coding assistant query your codebase in real-time - find functions, classes, and understand code structure (supports TypeScript, Python, and more)
- **AI-Powered Documentation Assistant**: Let your AI coding assistant query your docs in real-time
- **Codebase Understanding**: Index your entire codebase - functions, classes, interfaces, and other language-specific entities
- **Internal Knowledge Base**: Index internal wikis, API docs, or technical documentation
- **Customer Support**: Provide accurate, context-aware answers from your documentation
- **Developer Onboarding**: Help new developers quickly find information in your codebase and documentation
- **API Documentation**: Make API documentation instantly queryable
- **Code Reference**: Ask questions about your codebase and get answers with direct links to GitHub source code

## Requirements

- **Node.js**: 20 or later
- **Supabase**: Vector store for embeddings and document storage
- **LLM Provider**: API key for OpenAI, Anthropic, Google, or Mistral
- **GitHub**: Repository with documentation (MDX) and/or code (TypeScript, Python, etc.) to ingest (optional)

## Getting Started

1. **Set up Supabase:**
   - Create a Supabase project
   - Note your project URL and service role key

2. **Configure mimir-rag:**
   ```bash
   cd mimir-rag
   cp .env.example .env
   # Edit .env with your Supabase and LLM credentials
   npm install
   make setup-db DB_URL=<your-db-url> DB_PASSWORD=<your-password>
   ```

3. **Ingest documentation:**
   ```bash
   npm run ingest:cli
   ```

4. **Start the server:**
   ```bash
   make server
   ```

5. **Set up MCP (optional):**
   ```bash
   cd ../mimir-mcp
   npm install
   npm run build
   # Configure in VS Code via Command Palette
   ```

## Configuration

Both projects are configured via environment variables. See individual README files for details:

- [mimir-rag configuration](./mimir-rag/README.md#configuration)
- [mimir-mcp configuration](./mimir-mcp/README.md#configuration-for-vs-code-claude-code-cline-etc)

## API Documentation

### mimir-rag Endpoints

**Public Endpoints (require API key):**
- **POST /v1/chat/completions** - OpenAI-compatible chat completions (streaming & non-streaming)
- **POST /ingest** - Trigger manual ingestion
- **GET /health** - Health check

**MCP Endpoints (no API key required):**
- **POST /mcp/ask** - Semantic search returning document chunks with content and metadata

**Webhook Endpoints:**
- **POST /webhook/github** - GitHub webhook for auto-ingestion

See [mimir-rag API documentation](./mimir-rag/README.md#api-endpoints) for detailed endpoint specifications.

### mimir-mcp Tools

- **askDocs** - Semantic search for documentation from AI assistants

See [mimir-mcp usage](./mimir-mcp/README.md#using-the-askdocs-tool) for details.

## Development

### Building Both Projects

```bash
# Build mimir-rag (TypeScript compilation happens automatically)
cd mimir-rag
npm install

# Build mimir-mcp
cd ../mimir-mcp
npm install
npm run build
```

### Running Tests

```bash
# mimir-rag
cd mimir-rag
npm test

# mimir-mcp
cd mimir-mcp
npm test
```

## Docker Support

mimir-rag includes Docker support for containerized deployment:

```bash
cd mimir-rag
make docker-build IMAGE_NAME=mimir-rag:local
make docker-run IMAGE_NAME=mimir-rag:local \
  CONFIG_PATH=./.env \
  DB_URL=postgresql://user@host:5432/db \
  DB_PASSWORD=secret \
  PORT=3000
```

## Troubleshooting

### mimir-rag Issues

- **Database connection fails**: Verify Supabase credentials and network connectivity
- **Ingestion fails**: Check GitHub token permissions and repository access
- **Embedding errors**: Verify LLM provider API key and model availability

### mimir-mcp Issues

- **MCP server not found**: Ensure absolute path in configuration and rebuild
- **Connection timeout**: Verify mimir-rag server is running on specified URL
- **API key errors**: Check LLM provider credentials in MCP configuration

See individual project READMEs for detailed troubleshooting guides.

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

ISC
