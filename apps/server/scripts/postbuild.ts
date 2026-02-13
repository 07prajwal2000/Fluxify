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
