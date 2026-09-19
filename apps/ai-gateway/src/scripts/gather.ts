import path from "node:path";
import { initializeLogger, logger } from "@fluxify/common";
import { create, insert } from "@orama/orama";
import { persistToFile } from "@orama/plugin-data-persistence/server";
import fs from "fs";
import { DOCS_INDEX_PATH } from "../constants";
import { extractFrontmatter } from "../lib/frontmatter";

// Initialize the logger for this script
initializeLogger({ serviceName: "fluxify.api-gateway-gather" });

await generateDocsIndex();

async function generateDocsIndex() {
	const db = create({
		schema: {
			id: "string",
			title: "string",
			description: "string",
			content: "string",
		},
	});
	const docsDir = path.join(__filename, "../../../../../docs");
	const docs = fs
		.readdirSync(docsDir, { recursive: true })
		.filter((filename) => filename.toString().endsWith(".md"))
		.map((filename) => path.join(docsDir, filename.toString()));

	let indexed = 0;

	for (const doc of docs) {
		try {
			const content = fs.readFileSync(doc).toString();
			const frontmatter = extractFrontmatter(content);
			if (!frontmatter.title) {
				logger.info(`Skipping ${doc}: Missing frontmatter title`);
				continue;
			}
			insert(db, {
				id: crypto.randomUUID(),
				title: frontmatter.title,
				description: frontmatter?.description ?? "",
				content,
			});
			indexed++;
		} catch (e) {
			logger.error(`Error processing ${doc}:`, e);
		}
	}

	const outputDir = path.dirname(DOCS_INDEX_PATH);
	if (!fs.existsSync(outputDir)) {
		fs.mkdirSync(outputDir, { recursive: true });
	} else if (fs.existsSync(DOCS_INDEX_PATH)) {
		fs.rmSync(DOCS_INDEX_PATH);
	}
	await persistToFile(db, "binary", DOCS_INDEX_PATH);
	logger.info(`[Gather] Indexed ${indexed} docs → ${DOCS_INDEX_PATH}`);
}
