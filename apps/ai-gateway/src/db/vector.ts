import { restoreFromFile } from "@orama/plugin-data-persistence/server";
import { search } from "@orama/orama";
import { DOCS_INDEX_PATH } from "../constants";
import type { AnyOrama } from "@orama/orama";
import { logger } from "@fluxify/common";

type Document = {
	id: string;
	title: string;
	description: string;
	content: string;
};

type DocsDB = AnyOrama;

let docsDB: DocsDB = null!;

export async function initDocsDB() {
	docsDB = await restoreFromFile("binary", DOCS_INDEX_PATH);
	logger.info(`Initialized docs index: ${DOCS_INDEX_PATH}`, "DocsDB");
}

export async function queryDocs(query: string, limit: number = 5) {
	const results = await search(docsDB, {
		term: query,
		properties: ["title", "description", "content"],
		limit,
	});

	return results.hits.map((hit) => hit.document as Document);
}
