import { startServer } from "./server";
import { getLogger } from "../utils/logger";

startServer().catch((error) => {
    const logger = getLogger();
    logger.error({ err: error }, "Failed to start server.");
    process.exitCode = 1;
});
