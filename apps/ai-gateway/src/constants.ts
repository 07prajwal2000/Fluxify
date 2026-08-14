import path from "path";
import { DOCS_INDEX_FILE_PATH } from "./lib/env";

// resolve, not join: DOCS_INDEX_FILE_PATH is absolute in container images, and
// path.join would append it to dirname instead of honouring it
// (/app/ai-gateway + /app/ai-gateway/docs-index.bin). Relative values still
// resolve against this file's directory, which is what the default expects.
export const DOCS_INDEX_PATH = path.resolve(
	import.meta.dirname,
	DOCS_INDEX_FILE_PATH,
);
