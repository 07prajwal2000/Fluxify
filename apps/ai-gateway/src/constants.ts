import path from "path";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
export const VECTOR_STORE_PATH = path.join(
	__dirname,
	"../dist/ai-gateway/vectors.bin",
);
