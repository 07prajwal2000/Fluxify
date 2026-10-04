import { generateID } from "@fluxify/lib";
import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import {
	blocksEntity,
	testSuiteBlockHooksEntity,
	type testSuitesEntity,
} from "../../../../db/schema";
import { CustomError } from "../../../../errors/customError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import { blockName, matchHooks, replaceSuiteHooks } from "../../../../modules/testRunner/hooks";
import {
	type SuiteTarget,
	targetColumn,
	targetKeys,
	targetOf,
	targetProject,
} from "../../../../modules/testRunner/target";
import { createTestSuite } from "../create/repository";

type Suite = typeof testSuitesEntity.$inferSelect;

/** the request (route) or input (workflow) only makes sense on the same kind */
const EMPTY_REQUEST = {
	input: null,
	headers: {},
	params: {},
	queryParams: {},
	routeParams: {},
	contentType: null,
	body: null,
};

/** blocks of a canvas with the names hooks are matched by */
async function canvasBlocks(target: SuiteTarget) {
	const rows = await db
		.select({ id: blocksEntity.id, type: blocksEntity.type, data: blocksEntity.data })
		.from(blocksEntity)
		.where(eq(targetColumn(blocksEntity, target.type), target.id));
	return rows.map((b) => ({ id: b.id, type: b.type ?? "", name: blockName(b.data) }));
}

export default async function handleRequest(suite: Suite, projectId: string, target: SuiteTarget) {
	try {
		// project-scoped: a target elsewhere reads as missing, not forbidden
		if ((await targetProject(target)) !== projectId) {
			throw new NotFoundError(`${target.type} not found in this project`);
		}
		const source = targetOf(suite);

		const sourceHooks = await db
			.select({
				blockId: testSuiteBlockHooksEntity.blockId,
				onBefore: testSuiteBlockHooksEntity.onBefore,
				onAfter: testSuiteBlockHooksEntity.onAfter,
				blockType: blocksEntity.type,
				data: blocksEntity.data,
			})
			.from(testSuiteBlockHooksEntity)
			.innerJoin(blocksEntity, eq(blocksEntity.id, testSuiteBlockHooksEntity.blockId))
			.where(eq(testSuiteBlockHooksEntity.suiteId, suite.id));
		const { kept, dropped } = matchHooks(
			sourceHooks.map(({ data, blockType, ...h }) => ({
				...h,
				blockType: blockType ?? "",
				blockName: blockName(data),
			})),
			await canvasBlocks(target),
		);

		const { id: _id, createdAt: _c, updatedAt: _u, ...fields } = suite;
		const id = generateID();
		await db.transaction(async (tx) => {
			await createTestSuite(
				{
					...fields,
					...(source.type === target.type ? {} : EMPTY_REQUEST),
					id,
					name: `${suite.name} (copy)`,
					...targetKeys(target),
				},
				tx,
			);
			await replaceSuiteHooks(id, kept, tx);
		});
		return { id, droppedHooks: dropped };
	} catch (err: any) {
		if (err instanceof CustomError) throw err;
		throw new ServerError(err.message || "Failed to clone test suite");
	}
}
