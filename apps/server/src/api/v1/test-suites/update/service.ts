import type z from "zod";
import { db } from "../../../../db";
import { BadRequestError } from "../../../../errors/badRequestError";
import { CustomError } from "../../../../errors/customError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { replaceSuiteHooks, validateHooks } from "../../../../modules/testRunner/hooks";
import { getTestSuiteById } from "../get-by-id/repository";
import type { requestBodySchema } from "./dto";
import { testOnlyBlocksOfRoute, updateTestSuite } from "./repository";

export default async function handleRequest(id: string, data: z.infer<typeof requestBodySchema>) {
	try {
		const { hooks, ...fields } = data;
		const updateData = Object.fromEntries(
			Object.entries(fields).filter(([_, v]) => v !== undefined),
		);

		if (Object.keys(updateData).length === 0 && hooks === undefined) {
			return { id };
		}

		const phaseBlocks = [fields.setupBlockId, fields.teardownBlockId].filter(
			(b): b is string => !!b,
		);
		if (hooks !== undefined || phaseBlocks.length) {
			const suite = await getTestSuiteById(id);
			if (!suite) throw new NotFoundError("Test suite not found");
			if (hooks !== undefined) await validateHooks(suite.routeId, hooks);
			// setup / teardown must be test-only blocks of this project, never a live one
			const allowed = await testOnlyBlocksOfRoute(suite.routeId, phaseBlocks);
			if (phaseBlocks.some((b) => !allowed.has(b))) {
				throw new BadRequestError(
					"Setup and teardown must be test-only custom blocks of this project",
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
