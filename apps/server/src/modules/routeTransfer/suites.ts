import { generateID } from "@fluxify/lib";
import { eq, inArray } from "drizzle-orm";
import { createTestSuite } from "../../api/v1/test-suites/create/repository";
import { type DbTransactionType, db } from "../../db";
import {
	customBlocksListEntity,
	integrationsEntity,
	type middlewaresEntity,
	type SuiteInput,
	testSuiteBlockHooksEntity,
	testSuitesEntity,
} from "../../db/schema";
import { replaceSuiteHooks } from "../testRunner/hooks";
import type { BundleSuite } from "./bundle";

/**
 * A route's or workflow's test suites in and out of the bundle form. A
 * `.fluxroute` export and a project backup (#1097, #1098) share this; they
 * differ only in how references to other resources travel, which the caller
 * decides.
 */

type Executor = DbTransactionType | typeof db;

/** what the suites test: exactly one route or one workflow */
export type SuiteTarget = { routeId: string } | { workflowId: string };

const targetColumn = (target: SuiteTarget) =>
	"routeId" in target
		? eq(testSuitesEntity.routeId, target.routeId)
		: eq(testSuitesEntity.workflowId, target.workflowId);

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
	/** keep integration ids rather than names (a project backup, whose integration table names them) */
	integrationIds?: boolean;
	/** also carry the app config override values (a backup that includes them) */
	values?: boolean;
};

export async function exportSuites(
	target: SuiteTarget,
	{ tx = db, integrationIds = false, values = false }: SuiteExport = {},
): Promise<BundleSuite[]> {
	const suites = await tx
		.select()
		.from(testSuitesEntity)
		.where(targetColumn(target))
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
		suites
			.flatMap((s) => [s.setupBlockId, s.teardownBlockId, s.input?.loaderBlockId])
			.filter((id): id is string => !!id),
		tx,
	);
	const integrationIdsUsed = suites.flatMap((s) =>
		(s.integrationOverrides ?? []).flatMap((o) => [o.existingId, o.newId]),
	);
	const integrationNames = integrationIds
		? new Map(integrationIdsUsed.map((id) => [id, id]))
		: await namesOf(integrationsEntity, integrationIdsUsed, tx);
	const blockName = (id: string | null | undefined) => (id ? (blockNames.get(id) ?? null) : null);

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
		setupBlock: blockName(s.setupBlockId),
		teardownBlock: blockName(s.teardownBlockId),
		setupTimeoutMs: s.setupTimeoutMs,
		teardownTimeoutMs: s.teardownTimeoutMs,
		runAlone: s.runAlone,
		enabled: s.enabled,
		hooks: hooks
			.filter((h) => h.suiteId === s.id)
			.map((h) => ({ blockId: h.blockId, onBefore: h.onBefore, onAfter: h.onAfter })),
		...(s.input ? { input: portableInput(s.input, blockName(s.input.loaderBlockId)) } : {}),
	}));
}

const portableInput = ({ loaderBlockId: _, ...input }: SuiteInput, loaderBlock: string | null) => ({
	...input,
	loaderBlock,
});

/** How a suite's references become this project's ids. A miss returns null/undefined, or throws. */
export type SuiteRefs = {
	block(name: string, role: "setup" | "teardown" | "loader", suite: string): string | null;
	integration(
		override: { existing: string; replacement: string },
		suite: string,
	): { existingId: string; newId: string } | null;
	/** a hook's block id → the id that block has in the new canvas */
	canvasBlock(id: string): string | undefined;
	warn(message: string): void;
};

export async function writeSuites(
	target: SuiteTarget,
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
			input,
			...fields
		} = suite;
		const suiteId = generateID();
		const block = (name: string | null | undefined, role: "setup" | "teardown" | "loader") =>
			name ? refs.block(name, role, suite.name) : null;
		const { loaderBlock, ...rest } = input ?? {};
		await createTestSuite(
			{
				...fields,
				...target,
				id: suiteId,
				setupBlockId: block(setupBlock, "setup"),
				teardownBlockId: block(teardownBlock, "teardown"),
				input: input
					? ({ ...rest, loaderBlockId: block(loaderBlock, "loader") } as SuiteInput)
					: null,
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
