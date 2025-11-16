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
        "  -c, --config   Path to mimir.config.json (defaults to resolver logic).",
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

async function updateConfig(configPath: string, apiKey: string): Promise<void> {
    const raw = await fs.readFile(configPath, "utf8");
    const config = JSON.parse(raw) as Record<string, any>;

    if (typeof config.server !== "object" || config.server === null) {
        config.server = {};
    }

    const previousKey = config.server.apiKey;
    config.server.apiKey = apiKey;

    const formatted = `${JSON.stringify(config, null, 2)}\n`;
    await fs.writeFile(configPath, formatted, "utf8");

    console.log(`Updated server.apiKey in ${configPath}.`);
    if (typeof previousKey === "string") {
        console.log("Previous key has been overwritten.");
    }
    console.log(`New API key: ${apiKey}`);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const resolvedPath = resolveConfigPath(options.configPath);
    const apiKey = generateApiKey(options.byteLength);
    await updateConfig(resolvedPath, apiKey);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
