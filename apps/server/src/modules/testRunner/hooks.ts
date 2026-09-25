import { hookSupport } from "@fluxify/blocks/testHooks";
import { and, eq, inArray } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { blocksEntity, type TestHookBody, testSuiteBlockHooksEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { type SuiteTarget, targetColumn } from "./target";

/** a suite's hooks on one block, as the API reads and writes them */
export type BlockHook = {
	blockId: string;
	onBefore?: TestHookBody | null;
	onAfter?: TestHookBody | null;
};

/** what the test child needs per hooked block; names label `t.expect` lines */
export type SuiteHook = {
	blockId: string;
	blockType: string;
	blockName: string;
	onBefore: TestHookBody | null;
	onAfter: TestHookBody | null;
};

/**
 * Every hook must sit on a block of the suite's own route or workflow that allows it. The
 * portal only offers valid blocks, but the API is the boundary.
 */
export async function validateHooks(target: SuiteTarget, hooks: BlockHook[]) {
	const ids = [...new Set(hooks.map((h) => h.blockId))];
	if (ids.length !== hooks.length)
		throw new BadRequestError("A block can have only one hook entry");
	if (ids.length === 0) return;

	const blocks = await db
		.select({ id: blocksEntity.id, type: blocksEntity.type })
		.from(blocksEntity)
		.where(
			and(inArray(blocksEntity.id, ids), eq(targetColumn(blocksEntity, target.type), target.id)),
		);
	const typeOf = new Map(blocks.map((b) => [b.id, b.type ?? ""]));

	for (const hook of hooks) {
		const type = typeOf.get(hook.blockId);
		if (type === undefined) {
			throw new BadRequestError(`Block ${hook.blockId} is not on this suite's ${target.type}`);
		}
		const support = hookSupport(type);
		if (support === "none") throw new BadRequestError(`A ${type} block cannot have hooks`);
		// JSON before-hook = skip with that output; an input-only block cannot be skipped
		if (support === "input" && (hook.onAfter || hook.onBefore?.kind === "json")) {
			throw new BadRequestError(
				`A ${type} block only allows an onBefore script that changes its input`,
			);
		}
	}
}

/** replace the suite's hooks with `hooks`; an entry with neither hook is dropped */
export async function replaceSuiteHooks(
	suiteId: string,
	hooks: BlockHook[],
	tx: DbTransactionType,
) {
	await tx.delete(testSuiteBlockHooksEntity).where(eq(testSuiteBlockHooksEntity.suiteId, suiteId));
	const rows = hooks
		.filter((h) => h.onBefore || h.onAfter)
		.map((h) => ({
			suiteId,
			blockId: h.blockId,
			onBefore: h.onBefore ?? null,
			onAfter: h.onAfter ?? null,
		}));
	if (rows.length) await tx.insert(testSuiteBlockHooksEntity).values(rows);
}

/** hooks for each suite, with the block's type and name the child labels results by */
export async function loadSuiteHooks(suiteIds: string[]) {
	const bySuite = new Map<string, SuiteHook[]>();
	if (suiteIds.length === 0) return bySuite;
	const rows = await db
		.select({
			suiteId: testSuiteBlockHooksEntity.suiteId,
			blockId: testSuiteBlockHooksEntity.blockId,
			onBefore: testSuiteBlockHooksEntity.onBefore,
			onAfter: testSuiteBlockHooksEntity.onAfter,
			blockType: blocksEntity.type,
			data: blocksEntity.data,
		})
		.from(testSuiteBlockHooksEntity)
		.innerJoin(blocksEntity, eq(blocksEntity.id, testSuiteBlockHooksEntity.blockId))
		.where(inArray(testSuiteBlockHooksEntity.suiteId, suiteIds));
	for (const { suiteId, data, blockType, ...hook } of rows) {
		const list = bySuite.get(suiteId) ?? [];
		list.push({
			...hook,
			blockType: blockType ?? "",
			// "Name" is the server's placeholder for an unnamed block, not a name
			blockName:
				(typeof data?.blockName === "string" &&
					data.blockName.trim() !== "Name" &&
					data.blockName.trim()) ||
				blockType ||
				"",
		});
		bySuite.set(suiteId, list);
	}
	return bySuite;
}
