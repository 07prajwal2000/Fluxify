import type { z } from "zod";
import { requestQuerySchema, type responseSchema } from "./dto";
import { getKeysList } from "./repository";

export default async function handleRequest(
	projectId: string,
	search?: string,
): Promise<z.infer<typeof responseSchema>> {
	const keys = await getKeysList(projectId, search);
	return keys.map((item) => item.keyName!);
}
