import crypto from "node:crypto";

function generateApiKey(): string {
    return `coderag_${crypto.randomBytes(32).toString("hex")}`;
}

const apiKey = generateApiKey();
console.log("Generated API Key:");
console.log(apiKey);
console.log("\nAdd this to your .env file:");
console.log(`API_KEY=${apiKey}`);

