#!/usr/bin/env node
import dotenv from "dotenv";
dotenv.config();
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";

function requireEnv(name: string) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

function getEnv(name: string, defaultValue?: string): string | undefined {
    return process.env[name] || defaultValue;
}

// Required environment variables
const MIMIR_API_URL = getEnv("MIMIR_API_URL", "http://localhost:3000");
const MIMIR_PROVIDER = requireEnv("MIMIR_PROVIDER");
const MIMIR_MODEL = requireEnv("MIMIR_MODEL");
const MIMIR_API_KEY = requireEnv("MIMIR_API_KEY");

const server = new McpServer({
    name: "Mimir MCP Server",
    version: "1.0.0"
});

server.registerTool(
    "askDocs",
    {
        title: "Mimir Documentation Assistant",
        description: "Query your documentation using the Mimir RAG system. This tool has access to ingested documentation and can answer questions about your codebase, APIs, implementation patterns, code examples, troubleshooting, and best practices. Use this tool when you need context-aware answers from your documentation. More detailed queries yield better responses.",
        inputSchema: {
            question: z.string().describe("Your question about the documentation. Include specific context like: what you're trying to build, error messages, code snippets, or particular features you need help with. More detailed queries yield better responses."),
            matchCount: z.number().optional().describe("Number of relevant document chunks to retrieve (default: 10)"),
            similarityThreshold: z.number().optional().describe("Minimum similarity score for matching documents (default: 0.2)"),
            systemPrompt: z.string().optional().describe("Custom system prompt to guide the AI's response")
        }
    },
    async ({ question, matchCount, similarityThreshold, systemPrompt }) => {
        try {
            const requestBody: any = {
                question,
                provider: MIMIR_PROVIDER,
                model: MIMIR_MODEL,
                apiKey: MIMIR_API_KEY
            };

            if (matchCount !== undefined) requestBody.matchCount = matchCount;
            if (similarityThreshold !== undefined) requestBody.similarityThreshold = similarityThreshold;
            if (systemPrompt !== undefined) requestBody.systemPrompt = systemPrompt;

            const response = await axios.post(
                `${MIMIR_API_URL}/mcp/ask`,
                requestBody,
                {
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );

            const data = response.data;

            if (data.status === "ok") {
                return {
                    content: [{ type: "text", text: data.answer }]
                };
            } else {
                return {
                    content: [{ type: "text", text: `Error: ${data.message || 'Unknown error'}` }]
                };
            }
        } catch (error) {
            console.error("Error querying Mimir API:", error);
            const errorMessage = axios.isAxiosError(error)
                ? `API Error: ${error.response?.data?.message || error.message}`
                : `Error: ${(error as Error).message}`;

            return {
                content: [{ type: "text", text: `Couldn't fetch documentation: ${errorMessage}` }]
            };
        }
    }
)

const transport = new StdioServerTransport();
await server.connect(transport);