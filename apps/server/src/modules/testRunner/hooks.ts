import { blockName } from "@fluxify/blocks";
import { hookSupport, skipBranches } from "@fluxify/blocks/testHooks";
import { and, eq, inArray } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import { blocksEntity, type TestHookBody, testSuiteBlockHooksEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { skipBranchLiterals } from "./hookBranches";
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
		// `t.skip(output, "name")` must name a branch the block has
		const branches = skipBranches(type);
		const script = hook.onBefore?.kind === "script" ? hook.onBefore.value : "";
		const unknown = branches.length
			? skipBranchLiterals(script).find((name) => !branches.includes(name))
			: undefined;
		if (unknown !== undefined) {
			throw new BadRequestError(
				`A ${type} block has no branch "${unknown}"; t.skip can use: ${branches.join(", ")}`,
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

type CanvasBlock = { id: string; type: string; name: string };

/**
 * Move a suite's hooks onto another canvas (#497). Block ids are unique across
 * every canvas, so a hook keeps its block on the same target and otherwise
 * moves to the one block there with the same type and name. Hooks with no such
 * block, or whose block is already taken, are dropped.
 */
export function matchHooks(
	hooks: (BlockHook & { blockType: string; blockName: string })[],
	targetBlocks: CanvasBlock[],
) {
	const kept: BlockHook[] = [];
	const dropped: string[] = [];
	const used = new Set<string>();
	for (const { blockType, blockName: name, ...hook } of hooks) {
		const byId = targetBlocks.find((b) => b.id === hook.blockId);
		const byName = targetBlocks.filter((b) => name && b.type === blockType && b.name === name);
		const block = byId ?? (byName.length === 1 ? byName[0] : undefined);
		if (!block || used.has(block.id)) {
			dropped.push(name || blockType);
			continue;
		}
		used.add(block.id);
		kept.push({ ...hook, blockId: block.id });
	}
	return { kept, dropped };
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
			blockName: blockName(data) || blockType || "",
		});
		bySuite.set(suiteId, list);
	}
	return bySuite;
}
