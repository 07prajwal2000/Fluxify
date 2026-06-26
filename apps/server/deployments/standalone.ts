import { serve } from "bun";
import { app } from "../src/server";
import { logger } from "@fluxify/common";

const port = Number(process.env.SERVER_PORT) || 5500;

const server = serve({
	fetch: app.fetch,
	port,
});

logger.info(
	`standalone server is running at ${server.hostname}:${server.port}`,
);
