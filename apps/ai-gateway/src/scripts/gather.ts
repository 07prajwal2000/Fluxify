import fs from "node:fs";
import path from "node:path";
import { initializeLogger, logger } from "@fluxify/common";
import { persistToFile } from "@orama/plugin-data-persistence/server";
import { DOCS_INDEX_PATH } from "../constants";
import { buildDocsDB, chunkPage, type DocSection } from "../db/vector";

// Initialize the logger for this script
initializeLogger({ serviceName: "fluxify.api-gateway-gather" });

await generateDocsIndex();

/** One entry per `##` section of every titled page under docs/ (see chunkPage). */
async function generateDocsIndex() {
	const docsDir = path.join(__filename, "../../../../../docs");
	const pages = fs
		.readdirSync(docsDir, { recursive: true })
		.map((f) => f.toString().replaceAll("\\", "/"))
		// .vitepress/dist holds built .md copies of every page
		.filter((f) => f.endsWith(".md") && !f.split("/").some((part) => part.startsWith(".")));

	const sections: DocSection[] = [];
	let indexed = 0;
	for (const file of pages) {
		try {
			const chunks = chunkPage(
				file.slice(0, -3),
				fs.readFileSync(path.join(docsDir, file), "utf8"),
			);
			if (!chunks) {
				logger.info(`Skipping ${file}: Missing frontmatter title`);
				continue;
			}
			sections.push(...chunks);
			indexed++;
		} catch (e) {
			logger.error(`Error processing ${file}:`, e);
		}
	}

	const outputDir = path.dirname(DOCS_INDEX_PATH);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	} else if (fs.existsSync(DOCS_INDEX_PATH)) {
		fs.rmSync(DOCS_INDEX_PATH);
	}
	await persistToFile(buildDocsDB(sections), "binary", DOCS_INDEX_PATH);
	logger.info(
		`[Gather] Indexed ${indexed} docs (${sections.length} sections) → ${DOCS_INDEX_PATH}`,
	);
}
