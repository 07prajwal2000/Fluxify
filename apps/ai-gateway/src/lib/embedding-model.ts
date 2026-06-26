import {
	env,
	FeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";
import { EMBEDDING_MODEL } from "../constants";
import path from "path";
import { logger } from "@fluxify/common";

let pipe: FeatureExtractionPipeline = null!;
const LOCAL_MODELS_DIR = path.resolve("./.models");

env.localModelPath = LOCAL_MODELS_DIR;
env.cacheDir = LOCAL_MODELS_DIR;
env.allowLocalModels = true;

export async function loadEmbeddingModel() {
	pipe = await pipeline("feature-extraction", EMBEDDING_MODEL);
	logger.info(`[Embedding Model] Loaded embedding model: ${EMBEDDING_MODEL}`);
}

export async function generateEmbedding(text: string) {
	logger.info(`[Embedding Model] Generating embedding for text: ${text}`);
	const embedding = await pipe(text, {
		pooling: "mean",
		normalize: true,
	});
	return [...embedding.data] as number[];
}
