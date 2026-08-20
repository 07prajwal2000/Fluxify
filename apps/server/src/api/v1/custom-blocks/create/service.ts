import z from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import {
	createDependencies,
	createCustomBlock,
	checkCustomBlockExist,
	checkProjectExist,
} from "./repository";
import { ConflictError } from "../../../../errors/conflictError";
import { db, type DbTransactionType } from "../../../../db";
import { generateID, withCustomBlockPrefix } from "@fluxify/lib";
import { NotFoundError } from "../../../../errors/notFoundError";

/**
 * `outer` joins a transaction already in progress, so the ops bus can create a
 * custom block and its canvas atomically.
 */
export default async function handleRequest(
	data: z.infer<typeof requestBodySchema>,
	outer?: DbTransactionType,
	/** false when the caller is about to write its own canvas for this block. */
	seedDefaultBlocks = true,
): Promise<z.infer<typeof responseSchema>> {
	const result = await (outer ?? db).transaction(async (tx) => {
		const projectExist = await checkProjectExist(data.projectId, tx);
		if (!projectExist) {
			throw new NotFoundError(
				`project with id ${data.projectId} does not exist`,
			);
		}
		// Idempotent: callers that already resolved the stored name — the harness
		// binds a route to a block by it — must not end up double-prefixed.
		data.name = withCustomBlockPrefix(data.name);
		const existingBlock = await checkCustomBlockExist(
			data.projectId,
			data.name,
			tx,
		);
		if (existingBlock) {
			throw new ConflictError(
				`custom block with name ${data.name} already exists in this project`,
			);
		}
		const id = generateID();
		const newBlockId = await createCustomBlock({ ...data, id }, tx);
		if (seedDefaultBlocks) await createDependencies(newBlockId, tx);
		return {
			id: newBlockId,
		};
	});
	return result;
}
