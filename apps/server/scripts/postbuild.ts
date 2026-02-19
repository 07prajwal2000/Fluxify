import { DocSearch } from "../src/lib/docs";
import path from "path";

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
console.log("Generating schema.sql");
const sqlText = await Bun.$`bun x drizzle-kit export --sql`.text();
const sqlPath = path.join(serverPath, "dist/schema.sql");
await Bun.file(sqlPath).write(sqlText);
console.log("Generated", sqlPath);
