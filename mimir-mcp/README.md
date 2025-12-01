# mimir-mcp

MCP (Model Context Protocol) server that connects your AI coding assistant to the Mimir documentation RAG system. This allows AI assistants like Claude Code, VS Code extensions, or other MCP clients to semantically search your ingested documentation.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is an open protocol that enables AI assistants to securely access external data sources and tools. This MCP server exposes your Mimir documentation as a semantic search tool that AI assistants can use to find relevant documentation chunks.

## Features

- **Documentation Search Tool**: Provides an `askDocs` tool that AI assistants can invoke
- **Zero Configuration**: No API keys or environment variables needed - just install via npm
- **No Authentication Required**: Bypasses mimir-rag's `MIMIR_SERVER_API_KEY` authentication
- **Fast and Cost-Effective**: Skips additional LLM calls - returns document chunks directly
- **Configurable Parameters**: Supports custom match count and similarity threshold

## Installation

### Option 1: Install from npm (Recommended)

Once published to npm, users can install and use the MCP server without any local setup:

1. Open VS Code Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux)
2. Search for and select **"MCP: Open User Configuration"**
3. Add the following configuration:

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

**Note**: Replace `@your-org/mimir-mcp` with the actual npm package name once published.

4. Restart VS Code or reload the MCP extension

The MCP server is pre-configured to use the production backend URL - no additional configuration needed!

### Option 2: Local Development

For local development and testing:

1. Clone the repository and navigate to the `mimir-mcp` directory:
   ```bash
   cd mimir-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Modify `MIMIR_API_URL` in `src/index.ts` to point to your local backend:
   ```typescript
   const MIMIR_API_URL = "http://localhost:3000";
   ```

4. Build the project:
   ```bash
   npm run build
   ```

5. Configure in VS Code:
   ```json
   {
     "mcpServers": {
       "mimir": {
         "command": "node",
         "args": ["/absolute/path/to/mimir/mimir-mcp/dist/index.js"]
       }
     }
   }
   ```

6. Restart VS Code or reload the MCP extension

## Configuration for Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Option 1: Using npm package (Recommended)

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

**Note**: Replace `@your-org/mimir-mcp` with the actual npm package name once published.

### Option 2: Local development

```json
{
  "mcpServers": {
    "mimir": {
      "command": "node",
      "args": ["/absolute/path/to/mimir/mimir-mcp/dist/index.js"]
    }
  }
}
```

**Note**: For local development, remember to modify `MIMIR_API_URL` in `src/index.ts` to `http://localhost:3000`.

## Using the askDocs Tool

Once configured, the AI assistant will have access to an `askDocs` tool. You can ask questions like:

- "Find documentation about authentication implementation"
- "Search the docs for API endpoint examples"
- "What does the documentation say about error handling?"

The AI assistant will automatically invoke `askDocs`, retrieve relevant documentation chunks, and synthesize an answer for you.

The tool accepts these parameters:

- **question** (required): Your documentation search query
- **matchCount** (optional): Number of document chunks to retrieve (default: 10)
- **similarityThreshold** (optional): Minimum similarity score (default: 0.2)

## How It Works

1. The MCP server registers an `askDocs` tool with the AI assistant
2. When invoked, it sends a request to the mimir-rag backend's `/mcp/ask` endpoint
3. mimir-rag performs semantic search using OpenAI embeddings
4. Relevant documentation chunks with content and metadata are returned
5. The AI assistant synthesizes an answer based on the retrieved content

## Prerequisites

- A hosted [mimir-rag](../mimir-rag) backend with ingested documentation (or running locally for testing)
- Node.js 20 or later
- An AI assistant that supports MCP (Claude Code, Cline, Claude Desktop, etc.)

## Troubleshooting

### Connection Issues

If the MCP server can't connect to mimir-rag:

1. Verify the mimir-rag backend is accessible: `curl https://your-backend.com/health`
2. For local development, ensure you've modified `MIMIR_API_URL` in `src/index.ts` to `http://localhost:3000`
3. Ensure there are no firewall or network issues
4. For local testing, verify the backend is running on the correct port

### AI Assistant Not Seeing the Tool

1. Restart your AI assistant (VS Code, Claude Desktop, etc.)
2. Check the MCP configuration file syntax is valid JSON
3. Verify the path to `dist/index.js` is absolute, not relative
4. Open Command Palette and verify MCP configuration was saved correctly
5. Check the AI assistant's MCP logs for errors

### Empty Results

1. Verify your mimir-rag server has ingested documentation
2. Check the embeddings were created successfully during ingestion
3. Try lowering the `similarityThreshold` parameter for broader matches

## Development

To rebuild after making changes:

```bash
npm run build
```

The build process uses `tsup` to compile TypeScript to ESM format.

## Running Standalone

While this is primarily designed as an MCP server, you can also run it standalone for testing:

```bash
# For local testing, first modify MIMIR_API_URL in src/index.ts to:
# const MIMIR_API_URL = "http://localhost:3000";

# Then rebuild and run
npm run build
node dist/index.js
```

The server will communicate via stdio, which is the standard MCP transport protocol.
