import fs from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolveConfigPath } from "../config/loadConfig";

interface CliOptions {
    configPath?: string;
    byteLength: number;
}

function printHelp(): void {
    const lines = [
        "Usage: generate-api-key [--config <path>] [--bytes <n>]",
        "",
        "Options:",
        "  -c, --config   Path to .env file (defaults to .env in package root).",
        "  -b, --bytes    Number of random bytes to generate before encoding (default: 32).",
        "  -h, --help     Show this help message.",
    ];
    console.log(lines.join("\n"));
}

function parseArgs(argv: string[]): CliOptions {
    let configPath: string | undefined;
    let byteLength = 32;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];

        switch (arg) {
            case "-h":
            case "--help":
                printHelp();
                process.exit(0);
            case "-c":
            case "--config":
                configPath = argv[i + 1];
                i += 1;
                break;
            case "-b":
            case "--bytes":
                {
                    const value = Number.parseInt(argv[i + 1], 10);
                    if (Number.isNaN(value) || value <= 0) {
                        throw new Error("The --bytes option must be a positive integer.");
                    }
                    byteLength = value;
                    i += 1;
                }
                break;
            default:
                if (!configPath) {
                    configPath = arg;
                }
                break;
        }
    }

    return { configPath, byteLength };
}

function generateApiKey(byteLength: number): string {
    return randomBytes(byteLength).toString("base64url");
}

async function updateEnvFile(envPath: string, apiKey: string): Promise<void> {
    let content = "";
    let previousKey: string | undefined;

    try {
        content = await fs.readFile(envPath, "utf8");
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== "ENOENT") {
            throw error;
        }
        // File doesn't exist, we'll create it
        console.log(`Creating new .env file at ${envPath}`);
    }

    const lines = content.split("\n");
    let keyUpdated = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith("MIMIR_SERVER_API_KEY=")) {
            const match = line.match(/^MIMIR_SERVER_API_KEY=(.*)$/);
            if (match) {
                previousKey = match[1];
            }
            lines[i] = `MIMIR_SERVER_API_KEY=${apiKey}`;
            keyUpdated = true;
            break;
        }
    }

    if (!keyUpdated) {
        // Add the key if it doesn't exist
        if (content && !content.endsWith("\n")) {
            lines.push("");
        }
        lines.push(`MIMIR_SERVER_API_KEY=${apiKey}`);
    }

    const updatedContent = lines.join("\n");
    await fs.writeFile(envPath, updatedContent, "utf8");

    console.log(`Updated MIMIR_SERVER_API_KEY in ${envPath}.`);
    if (previousKey) {
        console.log("Previous key has been overwritten.");
    }
    console.log(`New API key: ${apiKey}`);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const resolvedPath = resolveConfigPath(options.configPath);
    const apiKey = generateApiKey(options.byteLength);
    await updateEnvFile(resolvedPath, apiKey);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
