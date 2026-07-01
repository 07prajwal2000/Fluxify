import path from "path";
import { DOCS_INDEX_FILE_PATH } from "./lib/env";

export const DOCS_INDEX_PATH = path.join(
	import.meta.dirname,
	DOCS_INDEX_FILE_PATH,
);
