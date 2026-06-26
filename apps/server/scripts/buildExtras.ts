import { initializeLogger, logger } from "@fluxify/common";
import { DocSearch } from "../src/lib/docs";
import path from "path";

initializeLogger({ serviceName: "fluxify-server-build" });

const cwd = process.cwd();
const isRelativeToApp = cwd.endsWith("server");
const docsPath = path.join(cwd, isRelativeToApp ? "../../" : "", "docs");
const docsIndexPath = path.join(
	cwd,
	isRelativeToApp ? "./" : "./apps/server/",
	"docs_index",
);
const docsSearch = new DocSearch();
await docsSearch.build(docsPath, docsIndexPath);
const serverPath = path.join(cwd, isRelativeToApp ? "" : "apps/server");
process.chdir(serverPath);
logger.info("Generating schema.sql");
const sqlText = await Bun.$`bun x drizzle-kit export --sql`.text();
const sqlPath = path.join(serverPath, "dist/schema.sql");
await Bun.file(sqlPath).write(sqlText);
logger.info("Generated", sqlPath);
