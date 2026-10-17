import { generateID } from "@fluxify/lib";
import type { z } from "zod";
import { ServerError } from "../../../../errors/serverError";
import { audit, bodyFields } from "../../../../modules/audit";
import { type SuiteTarget, targetKeys, targetProject } from "../../../../modules/testRunner/target";
import { deleteTestSuite } from "../delete/repository";
import type { requestBodySchema } from "./dto";
import { createTestSuite } from "./repository";

export default async function handleRequest(
	data: z.infer<typeof requestBodySchema>,
	target: SuiteTarget,
) {
	try {
		const created = await createTestSuite({
			id: generateID(),
			name: data.name,
			description: data.description,
			...targetKeys(target),
		});
		// no transaction to join here: if the event cannot be published, undo the insert
		try {
			await audit.record({
				projectId: async () => (await targetProject(target)) ?? null,
				resourceType: "test_suite",
				resourceId: created!.id,
				action: "create",
				changedFields: bodyFields(data),
			});
		} catch (err) {
			await deleteTestSuite(created!.id);
			throw err;
		}
		return created;
	} catch (err: any) {
		throw new ServerError(err.message || "Failed to create test suite");
	}
}
