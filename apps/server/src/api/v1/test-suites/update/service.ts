import type z from "zod";
import { db } from "../../../../db";
import { BadRequestError } from "../../../../errors/badRequestError";
import { CustomError } from "../../../../errors/customError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { replaceSuiteHooks, validateHooks } from "../../../../modules/testRunner/hooks";
import { targetOf, targetProject } from "../../../../modules/testRunner/target";
import { getTestSuiteById } from "../get-by-id/repository";
import type { requestBodySchema } from "./dto";
import { testOnlyBlocksOfProject, updateTestSuite } from "./repository";

export default async function handleRequest(id: string, data: z.infer<typeof requestBodySchema>) {
	try {
		const { hooks, ...fields } = data;
		const updateData = Object.fromEntries(
			Object.entries(fields).filter(([_, v]) => v !== undefined),
		);

		if (Object.keys(updateData).length === 0 && hooks === undefined) {
			return { id };
		}

		// setup, teardown and the input loader (#487) are all test-only blocks
		const testBlocks = [
			fields.setupBlockId,
			fields.teardownBlockId,
			fields.input?.source === "loader" ? fields.input.loaderBlockId : undefined,
		].filter((b): b is string => !!b);
		if (hooks !== undefined || testBlocks.length) {
			const suite = await getTestSuiteById(id);
			if (!suite) throw new NotFoundError("Test suite not found");
			const target = targetOf(suite);
			if (hooks !== undefined) await validateHooks(target, hooks);
			// must be test-only blocks of this project, never a live one
			const allowed = testBlocks.length
				? await testOnlyBlocksOfProject((await targetProject(target))!, testBlocks)
				: new Set<string>();
			if (testBlocks.some((b) => !allowed.has(b))) {
				throw new BadRequestError(
					"Setup, teardown and loader blocks must be test-only custom blocks of this project",
				);
			}
		}

		return await db.transaction(async (tx) => {
			const result = Object.keys(updateData).length
				? await updateTestSuite(id, updateData, tx)
				: { id };
			if (!result) throw new NotFoundError("Test suite not found");
			if (hooks !== undefined) await replaceSuiteHooks(id, hooks, tx);
			return result;
		});
	} catch (err: any) {
		if (err instanceof CustomError) throw err;
		throw new ServerError(err.message || "Failed to update test suite");
	}
}
