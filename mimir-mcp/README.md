# mimir-mcp

MCP (Model Context Protocol) server that connects your AI coding assistant to the Mimir documentation RAG system. This allows AI assistants like Claude Code, VS Code extensions, or other MCP clients to query your ingested documentation directly.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is an open protocol that enables AI assistants to securely access external data sources and tools. This MCP server exposes your Mimir documentation as a tool that AI assistants can use to answer questions based on your ingested docs.

## Features

- **Documentation Query Tool**: Provides an `askDocs` tool that AI assistants can invoke
- **Dynamic LLM Configuration**: Each MCP client can use its own LLM provider and API key
- **No Server API Key Required**: Bypasses mimir-rag's `MIMIR_SERVER_API_KEY` authentication
- **Configurable Parameters**: Supports custom match count, similarity threshold, and system prompts

## Installation

1. Navigate to the `mimir-mcp` directory:
   ```bash
   cd mimir-mcp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Configuration for VS Code (Claude Code, Cline, etc.)

### Step 1: Build the MCP Server

Make sure you've built the project:

```bash
npm run build
```

### Step 2: Configure MCP in VS Code

1. Open VS Code Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux)
2. Search for and select **"MCP: Open User Configuration"**
3. Add the following configuration to the JSON file that opens:

```json
{
  "mcpServers": {
    "mimir": {
      "command": "node",
      "args": ["/absolute/path/to/mimir/mimir-mcp/dist/index.js"],
      "env": {
        "MIMIR_API_URL": "http://localhost:3000",
        "MIMIR_PROVIDER": "anthropic",
        "MIMIR_MODEL": "claude-3-5-sonnet-20241022",
        "MIMIR_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

**Important**: Replace `/absolute/path/to/mimir` with the actual absolute path to your mimir project directory.

### Step 3: Restart VS Code or Reload the MCP Extension

After saving the configuration, restart VS Code or reload the MCP extension to apply the changes.

### Configuration Parameters

The `env` object accepts the following parameters:

- **MIMIR_API_URL** (optional): URL of your mimir-rag server. Default: `http://localhost:3000`
- **MIMIR_PROVIDER** (required): LLM provider name (`openai`, `anthropic`, `google`, `mistral`)
- **MIMIR_MODEL** (required): Model identifier (e.g., `claude-3-5-sonnet-20241022`, `gpt-4`, etc.)
- **MIMIR_API_KEY** (required): API key for your chosen LLM provider

## Configuration for Claude Desktop

To use this MCP server with Claude Desktop, add it to your Claude Desktop configuration file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "mimir": {
      "command": "node",
      "args": ["/absolute/path/to/mimir/mimir-mcp/dist/index.js"],
      "env": {
        "MIMIR_API_URL": "http://localhost:3000",
        "MIMIR_PROVIDER": "anthropic",
        "MIMIR_MODEL": "claude-3-5-sonnet-20241022",
        "MIMIR_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

## Using the askDocs Tool

Once configured, the AI assistant will have access to an `askDocs` tool. You can ask questions like:

- "Use askDocs to find out how to implement authentication"
- "Check the docs for API endpoint examples"
- "What does the documentation say about error handling?"

The tool accepts these parameters:

- **question** (required): Your documentation question
- **matchCount** (optional): Number of document chunks to retrieve (default: 10)
- **similarityThreshold** (optional): Minimum similarity score (default: 0.2)
- **systemPrompt** (optional): Custom system prompt to guide the AI's response

## How It Works

1. The MCP server registers an `askDocs` tool with the AI assistant
2. When invoked, it sends a request to the mimir-rag server's `/mcp/ask` endpoint
3. The request includes the question and your configured LLM credentials
4. mimir-rag retrieves relevant documentation chunks and generates an answer using your LLM
5. The answer is returned to the AI assistant, which can use it to help you

## Prerequisites

- A running [mimir-rag](../mimir-rag) server with ingested documentation
- Node.js 20 or later
- An AI assistant that supports MCP (Claude Code, Cline, Claude Desktop, etc.)
- API key for your chosen LLM provider

## Troubleshooting

### Connection Issues

If the MCP server can't connect to mimir-rag:

1. Verify your mimir-rag server is running: `curl http://localhost:3000/health`
2. Check the `MIMIR_API_URL` in your MCP configuration
3. Ensure there are no firewall or network issues

### AI Assistant Not Seeing the Tool

1. Restart your AI assistant (VS Code, Claude Desktop, etc.)
2. Check the MCP configuration file syntax is valid JSON
3. Verify the path to `dist/index.js` is absolute, not relative
4. Open Command Palette and verify MCP configuration was saved correctly
5. Check the AI assistant's MCP logs for errors

### API Key Issues

1. Verify your `MIMIR_API_KEY` is valid for the specified provider
2. Check you have sufficient quota/credits with your LLM provider
3. Ensure the `MIMIR_PROVIDER` and `MIMIR_MODEL` match your API key

## Development

To rebuild after making changes:

```bash
npm run build
```

The build process uses `tsup` to compile TypeScript to ESM format.

## Running Standalone

While this is primarily designed as an MCP server, you can also run it standalone for testing:

```bash
# Set environment variables
export MIMIR_API_URL=http://localhost:3000
export MIMIR_PROVIDER=anthropic
export MIMIR_MODEL=claude-3-5-sonnet-20241022
export MIMIR_API_KEY=your-api-key-here

# Run the server
node dist/index.js
```

The server will communicate via stdio, which is the standard MCP transport protocol.
