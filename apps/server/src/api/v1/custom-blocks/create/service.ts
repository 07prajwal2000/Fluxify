import z from "zod";
import { requestBodySchema, responseSchema } from "./dto";
import {
	createDependencies,
	createCustomBlock,
	checkCustomBlockExist,
	checkProjectExist,
} from "./repository";
import { ConflictError } from "../../../../errors/conflictError";
import { db } from "../../../../db";
import { generateID } from "@fluxify/lib";
import { NotFoundError } from "../../../../errors/notFoundError";

export default async function handleRequest(
	data: z.infer<typeof requestBodySchema>,
): Promise<z.infer<typeof responseSchema>> {
	const result = await db.transaction(async (tx) => {
		const projectExist = await checkProjectExist(data.projectId, tx);
		if (!projectExist) {
			throw new NotFoundError(
				`project with id ${data.projectId} does not exist`,
			);
		}
		data.name = `user_defined.project.${data.name}`;
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
		await createDependencies(newBlockId, tx);
		return {
			id: newBlockId,
		};
	});
	return result;
}
