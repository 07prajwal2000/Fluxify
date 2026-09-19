import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { EncryptionService } from "../../../../lib/encryption";
import type { responseSchema } from "./dto";
import { getAppConfigById } from "./repository";

export default async function handleRequest(
	projectId: string,
	id: number,
): Promise<z.infer<typeof responseSchema>> {
	if (!id || isNaN(id)) {
		throw new BadRequestError("Invalid id");
	}
	const result = await getAppConfigById(id, projectId);
	if (!result) {
		throw new NotFoundError(`App config not found with id: ${id}`);
	}
	if (result.isEncrypted) {
		result.value = EncryptionService.maskValue(result.value!, "*").substring(0, 20);
	} else {
		result.value = EncryptionService.decodeData(result.value!, result.encodingType!);
	}
	return {
		id: result.id,
		keyName: result.keyName!,
		description: result.description!,
		value: result.value!,
		isEncrypted: result.isEncrypted!,
		encodingType: result.encodingType!,
		dataType: result.dataType!,
		createdAt: result.createdAt!.toISOString()!,
		updatedAt: result.updatedAt!.toISOString()!,
	};
}
