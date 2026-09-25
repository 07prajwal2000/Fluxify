import { generateID } from "@fluxify/lib";
import type { z } from "zod";
import { ServerError } from "../../../../errors/serverError";
import { type SuiteTarget, targetKeys } from "../../../../modules/testRunner/target";
import type { requestBodySchema } from "./dto";
import { createTestSuite } from "./repository";

export default async function handleRequest(
	data: z.infer<typeof requestBodySchema>,
	target: SuiteTarget,
) {
	try {
		return await createTestSuite({
			id: generateID(),
			name: data.name,
			description: data.description,
			...targetKeys(target),
		});
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to create test suite");
	}
}
