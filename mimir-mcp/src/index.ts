#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";

// Production backend URL - change this for local development
// For local development, use: http://localhost:3000
const MIMIR_API_URL = "http://localhost:3000";

const server = new McpServer({
    name: "Mimir MCP Server",
    version: "1.0.0"
});

server.registerTool(
    "askDocs",
    {
        title: "Mimir Documentation Search",
        description: "Query your documentation using the Mimir RAG system. This tool performs semantic search on ingested documentation and returns relevant chunks with their content, similarity scores, and links. Use this to find information about your codebase, APIs, implementation patterns, code examples, troubleshooting, and best practices. More detailed queries yield better responses.",
        inputSchema: {
            question: z.string().describe("Your search query to find relevant documentation chunks. Can be a question, topic, or keywords.")
        }
    },
    async ({ question }) => {
        try {
            const response = await axios.post(
                `${MIMIR_API_URL}/mcp/ask`,
                { question },
                {
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );

            const data = response.data;

            if (data.status === "ok") {
                const matches = data.matches || [];
                const count = data.count || 0;

                if (count === 0) {
                    return {
                        content: [{ type: "text", text: "No matching documentation found." }]
                    };
                }

                let resultText = `Found ${count} matching document${count !== 1 ? 's' : ''}:\n\n`;

                matches.forEach((match: any, index: number) => {
                    resultText += `${index + 1}. ${match.chunkTitle}\n`;
                    if (match.similarity !== undefined) {
                        resultText += `   Similarity: ${(match.similarity * 100).toFixed(1)}%\n`;
                    }
                    if (match.chunkContent) {
                        resultText += `   Content: ${match.chunkContent}\n`
                    }
                    if (match.githubUrl) {
                        resultText += `   GitHub: ${match.githubUrl}\n`;
                    }
                    if (match.docsUrl) {
                        resultText += `   Docs: ${match.docsUrl}\n`;
                    }
                    resultText += '\n';
                });

                return {
                    content: [{ type: "text", text: resultText.trim() }]
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
                content: [{ type: "text", text: `Couldn't match documentation: ${errorMessage}` }]
            };
        }
    }
)

const transport = new StdioServerTransport();
await server.connect(transport);