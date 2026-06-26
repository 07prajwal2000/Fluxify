import { env, pipeline } from "@huggingface/transformers";
import fs from "fs";
import path from "node:path";
import { EMBEDDING_MODEL, VECTOR_STORE_PATH } from "../constants";
import { create, insert } from "@orama/orama";
import { persistToFile } from "@orama/plugin-data-persistence/server";
import { extractFrontmatter } from "../lib/frontmatter";
import { chunkMarkdown } from "../lib/token-chunk";
import { logger, initializeLogger } from "@fluxify/common";

// Initialize the logger for this script
initializeLogger({ serviceName: "fluxify.api-gateway-gather" });

// 1. Resolve an absolute path to your local project directory
const LOCAL_MODELS_DIR = path.resolve("./.models");

// 2. Configure Hugging Face environment override variables
env.allowRemoteModels = true;
env.allowLocalModels = true;
env.localModelPath = LOCAL_MODELS_DIR;
env.cacheDir = LOCAL_MODELS_DIR; // Crucial: forces download engine into this folder

const modelName = EMBEDDING_MODEL;
const expectedModelPath = path.join(LOCAL_MODELS_DIR, modelName);

if (!fs.existsSync(expectedModelPath)) {
	logger.info(
		`📥 Downloading ${modelName} cleanly into ${LOCAL_MODELS_DIR}...`,
	);

	// Triggers downloading straight to your newly targetted project folder
	const pipe = await pipeline("feature-extraction", modelName);
	logger.info("✅ Model downloaded and saved to your project directory!");
} else {
	logger.info("💪 Model already exists in ./models folder. Skipping download.");
}
await generateDocsIndex();

async function generateDocsIndex() {
	const pipe = await pipeline("feature-extraction", modelName);
	const db = await create({
		schema: {
			id: "string",
			title: "string",
			chunk: "number",
			description: "string",
			content: "string",
			vector: "vector[384]",
		},
	});
	const docsDir = path.join(__filename, "../../../../../docs");
	const docs = fs
		.readdirSync(docsDir, { recursive: true })
		.filter((filename) => filename.toString().endsWith(".md"))
		.map((filename) => path.join(docsDir, filename.toString()));
	for (const doc of docs) {
		try {
			const content = fs.readFileSync(doc).toString();
			const frontmatter = extractFrontmatter(content);
			const embedding = await pipe(content, {
				pooling: "mean",
				normalize: true,
			});
			if (!frontmatter.title) {
				logger.info(`Skipping ${doc}: Missing frontmatter title`);
				continue;
			}
			const chunks = chunkMarkdown(content, {
				maxLengthInTokens: 200,
				overlapTokens: 20,
			});
			for (const [i, chunk] of chunks.entries()) {
				const id = crypto.randomUUID();
				await insert(db, {
					id,
					title: frontmatter.title,
					chunk: i + 1,
					description: frontmatter?.description ?? "",
					content: chunk,
					vector: [...embedding.data],
				});
			}
		} catch (e) {
			logger.error(`Error processing ${doc}:`, e);
		}
	}
	if (!fs.existsSync(path.dirname(VECTOR_STORE_PATH))) {
		fs.mkdirSync(path.dirname(VECTOR_STORE_PATH), { recursive: true });
	} else {
		fs.rmSync(VECTOR_STORE_PATH);
	}
	await persistToFile(db, "binary", VECTOR_STORE_PATH);
}
