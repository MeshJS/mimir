# mimir-mcp

MCP (Model Context Protocol) server that connects your AI coding assistant to the Mimir documentation RAG system. This allows AI assistants like Claude Code, VS Code extensions, or other MCP clients to semantically search your ingested documentation.

**⚠️ Important**: Before publishing, you **must** change the package name from `mimir-mcp` to your own MCP name in `package.json` (e.g., `@your-org/your-mcp-name`). This ensures your MCP server has a unique identity.

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) is an open protocol that enables AI assistants to securely access external data sources and tools. This MCP server exposes your Mimir documentation as a semantic search tool that AI assistants can use to find relevant documentation chunks.

## Features

- **Documentation Search Tool**: Provides an `askDocs` tool that AI assistants can invoke
- **Configurable Backend**: Set your own Mimir RAG backend URL via environment variables
- **Customizable Server Name**: Configure the MCP server name to match your organization
- **Customizable Package Name**: Publish with your own npm package name
- **Fast and Cost-Effective**: Skips additional LLM calls - returns document chunks directly
- **Configurable Parameters**: Supports custom match count and similarity threshold

## Important Notes

- **Embeddings**: The Mimir backend uses its own embedding model. You cannot use a different LLM provider for embeddings as this would cause compatibility issues.
- **Chat Completions**: When using chat completions via the API, you'll need to provide your own LLM API keys (OpenAI, Anthropic, etc.) for the completion model. The embedding model is handled by the backend.

## Customization Before Publishing

Before publishing your own version of this MCP server, **you must customize the following**:

1. **Package Name** (`package.json`): **Change `"name": "@your-org/mimir-mcp"` to your own MCP name** (e.g., `@your-org/your-docs-mcp`, `@company/api-docs-mcp`, etc.). Do not use `mimir-mcp` as the package name - choose a name that reflects your organization and use case.
2. **Description** (`package.json`): Update the description to match your use case
3. **Author** (`package.json`): Add your name or organization
4. **License** (`package.json`): Set your preferred license

## Configuration

The MCP server requires the following environment variables:

- **`MIMIR_API_URL`** or **`MCP_BACKEND_URL`** (required): The URL of your Mimir RAG backend (e.g., `https://api.example.com` or `http://localhost:3000`)
- **`MCP_SERVER_NAME`** (optional): Custom name for the MCP server (defaults to "Mimir MCP Server")

## Installation

### Option 1: Install from npm (Recommended)

1. Open VS Code Command Palette (`Cmd+Shift+P` on macOS or `Ctrl+Shift+P` on Windows/Linux)
2. Search for and select **"MCP: Open User Configuration"**
3. Add the following configuration:

```json
{
  "mcpServers": {
    "mimir": {
      "command": "npx",
      "args": ["-y", "@your-org/your-mcp-name"],
      "env": {
        "MIMIR_API_URL": "https://your-backend-url.com",
        "MCP_SERVER_NAME": "Your Custom MCP Server Name"
      }
    }
  }
}
```

**Note**: 
- Replace `@your-org/your-mcp-name` with your published npm package name (not `mimir-mcp`)
- Replace `https://your-backend-url.com` with your actual Mimir RAG backend URL
- Customize the server name as needed

4. Restart VS Code or reload the MCP extension

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

3. Build the project:
   ```bash
   npm run build
   ```

4. Configure in VS Code with environment variables:
   ```json
   {
     "mcpServers": {
       "mimir": {
         "command": "node",
         "args": ["/absolute/path/to/mimir/mimir-mcp/dist/index.js"],
         "env": {
           "MIMIR_API_URL": "http://localhost:3000",
           "MCP_SERVER_NAME": "My Local Mimir MCP"
         }
       }
     }
   }
   ```

5. Restart VS Code or reload the MCP extension

## Configuration for Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Option 1: Using npm package (Recommended)

```json
{
  "mcpServers": {
    "mimir": {
      "command": "npx",
      "args": ["-y", "@your-org/your-mcp-name"],
      "env": {
        "MIMIR_API_URL": "https://your-backend-url.com",
        "MCP_SERVER_NAME": "Your Custom MCP Server Name"
      }
    }
  }
}
```

**Note**: Replace `@your-org/your-mcp-name` with your published npm package name (not `mimir-mcp`).

### Option 2: Local development

```json
{
  "mcpServers": {
    "mimir": {
      "command": "node",
      "args": ["/absolute/path/to/mimir/mimir-mcp/dist/index.js"],
      "env": {
        "MIMIR_API_URL": "http://localhost:3000",
        "MCP_SERVER_NAME": "My Local Mimir MCP"
      }
    }
  }
}
```

**Note**: Make sure to set `MIMIR_API_URL` to your actual backend URL. For local development, use `http://localhost:3000` (or your local port).

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
2. Ensure `MIMIR_API_URL` or `MCP_BACKEND_URL` environment variable is set correctly in your MCP configuration
3. Ensure there are no firewall or network issues
4. For local testing, verify the backend is running on the correct port and the URL matches your environment variable

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

## Publishing Your Own Version

To publish your customized MCP server:

1. **Customize package.json**:
   - **Change `name` from `@your-org/mimir-mcp` to your own MCP name** (e.g., `@your-org/your-docs-mcp`, `@company/api-mcp`, etc.). **Do not use `mimir-mcp`** - use a name unique to your organization.
   - Update `description`, `author`, and `license` as needed

2. **Build the package**:
   ```bash
   npm run build
   ```

3. **Publish to npm**:
   ```bash
   npm publish
   ```
   
   For scoped packages (e.g., `@your-org/your-mcp-name`), make sure you're logged in:
   ```bash
   npm login
   npm publish --access public
   ```

4. **Update your MCP configuration** to use your published package name

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
export MCP_SERVER_NAME="My Test Server"

# Build and run
npm run build
node dist/index.js
```

The server will communicate via stdio, which is the standard MCP transport protocol.

**Note**: The server will exit with an error if `MIMIR_API_URL` or `MCP_BACKEND_URL` is not set.
