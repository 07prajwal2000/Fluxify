import { generateID } from "@fluxify/lib";
import { eq, inArray } from "drizzle-orm";
import { createTestSuite } from "../../api/v1/test-suites/create/repository";
import { type DbTransactionType, db } from "../../db";
import {
	customBlocksListEntity,
	integrationsEntity,
	type middlewaresEntity,
	testSuiteBlockHooksEntity,
	testSuitesEntity,
} from "../../db/schema";
import { replaceSuiteHooks } from "../testRunner/hooks";
import type { BundleSuite } from "./bundle";

/**
 * A route's test suites in and out of a route bundle. A `.fluxroute` export and
 * a project backup (#1097) share this; they differ only in how references to
 * other resources travel, which the caller decides.
 */

type Executor = DbTransactionType | typeof db;

/** id → name for rows of `table`, so references can travel by name */
export async function namesOf(
	table: typeof middlewaresEntity | typeof customBlocksListEntity | typeof integrationsEntity,
	ids: string[],
	tx: Executor = db,
) {
	if (ids.length === 0) return new Map<string, string>();
	const rows = await tx
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(inArray(table.id, ids));
	return new Map(rows.map((r) => [r.id, r.name ?? ""]));
}

export type SuiteExport = {
	tx?: Executor;
	/** keep integration ids rather than names (a backup, until #1100 restores integrations) */
	integrationIds?: boolean;
	/** also carry the app config override values (a backup that includes them) */
	values?: boolean;
};

export async function exportSuites(
	routeId: string,
	{ tx = db, integrationIds = false, values = false }: SuiteExport = {},
): Promise<BundleSuite[]> {
	const suites = await tx
		.select()
		.from(testSuitesEntity)
		.where(eq(testSuitesEntity.routeId, routeId))
		.orderBy(testSuitesEntity.createdAt);
	if (suites.length === 0) return [];

	const hooks = await tx
		.select()
		.from(testSuiteBlockHooksEntity)
		.where(
			inArray(
				testSuiteBlockHooksEntity.suiteId,
				suites.map((s) => s.id),
			),
		);
	const blockNames = await namesOf(
		customBlocksListEntity,
		suites.flatMap((s) => [s.setupBlockId, s.teardownBlockId]).filter((id): id is string => !!id),
		tx,
	);
	const integrationIdsUsed = suites.flatMap((s) =>
		(s.integrationOverrides ?? []).flatMap((o) => [o.existingId, o.newId]),
	);
	const integrationNames = integrationIds
		? new Map(integrationIdsUsed.map((id) => [id, id]))
		: await namesOf(integrationsEntity, integrationIdsUsed, tx);

	return suites.map((s) => ({
		name: s.name,
		description: s.description,
		headers: s.headers ?? {},
		params: s.params ?? {},
		queryParams: s.queryParams ?? {},
		routeParams: s.routeParams ?? {},
		contentType: s.contentType as BundleSuite["contentType"],
		body: s.body ?? undefined,
		assertions: s.assertions,
		integrationOverrides: (s.integrationOverrides ?? []).flatMap((o) => {
			const existing = integrationNames.get(o.existingId);
			const replacement = integrationNames.get(o.newId);
			return existing && replacement ? [{ existing, replacement }] : [];
		}),
		appConfigOverrideKeys: (s.appConfigOverrides ?? []).map((o) => o.key),
		...(values ? { appConfigOverrides: s.appConfigOverrides ?? [] } : {}),
		setupBlock: s.setupBlockId ? (blockNames.get(s.setupBlockId) ?? null) : null,
		teardownBlock: s.teardownBlockId ? (blockNames.get(s.teardownBlockId) ?? null) : null,
		setupTimeoutMs: s.setupTimeoutMs,
		teardownTimeoutMs: s.teardownTimeoutMs,
		runAlone: s.runAlone,
		hooks: hooks
			.filter((h) => h.suiteId === s.id)
			.map((h) => ({ blockId: h.blockId, onBefore: h.onBefore, onAfter: h.onAfter })),
	}));
}

/** How a suite's references become this project's ids. A miss returns null/undefined, or throws. */
export type SuiteRefs = {
	block(name: string, role: "setup" | "teardown", suite: string): string | null;
	integration(
		override: { existing: string; replacement: string },
		suite: string,
	): { existingId: string; newId: string } | null;
	/** a hook's block id → the id that block has in the new canvas */
	canvasBlock(id: string): string | undefined;
	warn(message: string): void;
};

export async function writeSuites(
	routeId: string,
	suites: BundleSuite[],
	refs: SuiteRefs,
	tx: DbTransactionType,
) {
	for (const suite of suites) {
		const {
			hooks,
			integrationOverrides,
			appConfigOverrideKeys,
			appConfigOverrides,
			setupBlock,
			teardownBlock,
			...fields
		} = suite;
		const suiteId = generateID();
		await createTestSuite(
			{
				...fields,
				id: suiteId,
				routeId,
				setupBlockId: setupBlock ? refs.block(setupBlock, "setup", suite.name) : null,
				teardownBlockId: teardownBlock ? refs.block(teardownBlock, "teardown", suite.name) : null,
				integrationOverrides: integrationOverrides.flatMap((o) => {
					const found = refs.integration(o, suite.name);
					return found ? [found] : [];
				}),
				// a `.fluxroute` never carries the values, so it restores names only
				appConfigOverrides: appConfigOverrides ?? [],
			},
			tx,
		);
		if (!appConfigOverrides && appConfigOverrideKeys.length) {
			refs.warn(
				`Test "${suite.name}": set the values of the app config overrides ${appConfigOverrideKeys.join(", ")}.`,
			);
		}
		// ponytail: hooks are not re-run through validateHooks (it reads outside this transaction); the exporting server already validated them
		const remapped = hooks.flatMap((h) => {
			const blockId = refs.canvasBlock(h.blockId);
			return blockId ? [{ ...h, blockId }] : [];
		});
		if (remapped.length < hooks.length) {
			refs.warn(
				`Test "${suite.name}": ${hooks.length - remapped.length} block hook(s) had no block and were dropped.`,
			);
		}
		await replaceSuiteHooks(suiteId, remapped, tx);
	}
}
