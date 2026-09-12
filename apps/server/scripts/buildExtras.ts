import { initializeLogger, logger } from "@fluxify/common";
import path from "path";

initializeLogger({ serviceName: "fluxify-server-build" });

const cwd = process.cwd();
const isRelativeToApp = cwd.endsWith("server");
const serverPath = path.join(cwd, isRelativeToApp ? "" : "apps/server");
process.chdir(serverPath);
logger.info("Generating schema.sql");
const sqlText = await Bun.$`bun x drizzle-kit export --sql`.text();
const sqlPath = path.join(serverPath, "dist/schema.sql");
await Bun.file(sqlPath).write(sqlText);
logger.info("Generated", sqlPath);

// The admin bundle reaches the Kafka client too (test-connection, topic
// creation), so it needs the compression wasm beside it exactly like the
// worker bundles do. See the script for the path it has to land on.
await import("./copyNativeWasm");
