import { cpSync, rmSync } from "node:fs";
import { initializeLogger, logger } from "@fluxify/common";
import path from "path";

initializeLogger({ serviceName: "fluxify-server-build" });

const cwd = process.cwd();
const isRelativeToApp = cwd.endsWith("server");
const serverPath = path.join(cwd, isRelativeToApp ? "" : "apps/server");
process.chdir(serverPath);
// The admin server applies these on startup (#603). It looks for them next to
// its bundle, so they ship inside dist/.
const migrationsPath = path.join(serverPath, "dist/migrations");
rmSync(migrationsPath, { recursive: true, force: true });
cpSync(path.join(serverPath, "src/db/migrations"), migrationsPath, { recursive: true });
logger.info(`Copied migrations to ${migrationsPath}`);

// The admin bundle reaches the Kafka client too (test-connection, topic
// creation), so it needs the compression wasm beside it exactly like the
// worker bundles do. See the script for the path it has to land on.
await import("./copyNativeWasm");
