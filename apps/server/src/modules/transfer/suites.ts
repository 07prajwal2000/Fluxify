import { generateID } from "@fluxify/lib";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { createTestSuite } from "../../api/v1/test-suites/create/repository";
import {
	assertionSchema,
	blockHookSchema,
	suiteInputSchema,
} from "../../api/v1/test-suites/schema";
import { type DbTransactionType, db } from "../../db";
import {
	customBlocksListEntity,
	integrationsEntity,
	testSuiteBlockHooksEntity,
	testSuitesEntity,
} from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { CONTENT_TYPES } from "../../lib/routeConfig";
import { replaceSuiteHooks } from "../testRunner/hooks";
import { idsByName, namesOf } from "./names";

type Executor = DbTransactionType | typeof db;

export const bundleSuiteSchema = z.object({
	name: z.string().min(1),
	description: z.string().nullish(),
	/** off keeps the suite out of "Run all" and the promote tests gate; files without it are on */
	enabled: z.boolean().default(true),
	headers: z.record(z.string(), z.string()).default({}),
	params: z.record(z.string(), z.string()).default({}),
	queryParams: z.record(z.string(), z.string()).default({}),
	routeParams: z.record(z.string(), z.string()).default({}),
	contentType: z.enum(CONTENT_TYPES).nullish(),
	body: z.unknown().optional(),
	/** workflow suites: what feeds the workflow. The loader is a custom block *name* */
	input: z
		.object({
			source: z.enum(["raw", "script", "loader"]),
			mode: z.enum(["single", "cases"]),
			raw: z.unknown().optional(),
			script: z.string().optional(),
			loaderBlock: z.string().nullish(),
			timeoutMs: z.number().int().optional(),
		})
		.nullish(),
	assertions: z.array(assertionSchema).default([]),
	/** integration names: the one a route uses, and the one the suite swaps in */
	integrationOverrides: z
		.array(z.object({ existing: z.string(), replacement: z.string() }))
		.default([]),
	/** keys only: the values can be secrets and are never exported */
	appConfigOverrideKeys: z.array(z.string()).default([]),
	/** the values too: only a project backup that includes app config values (#1097) */
	appConfigOverrides: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
	/** custom block names */
	setupBlock: z.string().nullish(),
	teardownBlock: z.string().nullish(),
	setupTimeoutMs: z.number().int().default(30_000),
	teardownTimeoutMs: z.number().int().default(30_000),
	runAlone: z.boolean().default(false),
	/** `blockId` is a block id of this bundle's canvas */
	hooks: z.array(blockHookSchema).default([]),
});

export type BundleSuite = z.infer<typeof bundleSuiteSchema>;
export type SuiteOwner = { routeId: string } | { workflowId: string };

export type SuiteExport = {
	tx?: Executor;
	/** keep integration ids rather than names (a backup, until #1100 restores integrations) */
	integrationIds?: boolean;
	/** also carry the app config override values (a backup that includes them) */
	values?: boolean;
};

export async function exportSuites(
	owner: SuiteOwner,
	{ tx = db, integrationIds = false, values = false }: SuiteExport = {},
): Promise<BundleSuite[]> {
	const suites = await tx
		.select()
		.from(testSuitesEntity)
		.where(
			"routeId" in owner
				? eq(testSuitesEntity.routeId, owner.routeId)
				: eq(testSuitesEntity.workflowId, owner.workflowId),
		)
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

	return suites.map((s) => {
		const { loaderBlockId, ...input } = s.input ?? {};
		return {
			name: s.name,
			description: s.description,
			enabled: s.enabled,
			headers: s.headers ?? {},
			params: s.params ?? {},
			queryParams: s.queryParams ?? {},
			routeParams: s.routeParams ?? {},
			contentType: s.contentType as BundleSuite["contentType"],
			body: s.body ?? undefined,
			input: s.input
				? {
						...(input as Omit<NonNullable<typeof s.input>, "loaderBlockId">),
						loaderBlock: loaderBlockId ? (blockNames.get(loaderBlockId) ?? null) : null,
					}
				: null,
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
		};
	});
}

type ImportContext = {
	projectId: string;
	/** old block id → new block id of the imported canvas */
	blockIds: Map<string, string>;
	warnings: string[];
	/** "route" or "workflow", for error messages */
	label: string;
};

/** How a suite's references become this project's ids. A miss returns null, or throws. */
export type SuiteRefs = {
	block(name: string, role: "setup" | "teardown" | "loader", suite: string): string | null;
	integration(
		override: { existing: string; replacement: string },
		suite: string,
	): { existingId: string; newId: string } | null;
	/** a hook's block id → the id that block has in the new canvas */
	canvasBlock(id: string): string | undefined;
	warn(message: string): void;
	/** "route" or "workflow", for error messages */
	label?: string;
};

/** Creates the suites on `owner`; `refs` decides how references to other resources resolve. */
export async function writeSuites(
	owner: SuiteOwner,
	suites: BundleSuite[],
	refs: SuiteRefs,
	tx: DbTransactionType,
): Promise<void> {
	for (const [i, suite] of suites.entries()) {
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

		let suiteInput: z.infer<typeof suiteInputSchema> | null = null;
		if (input) {
			const { loaderBlock, ...rest } = input;
			const parsed = suiteInputSchema.safeParse({
				...rest,
				loaderBlockId: loaderBlock ? refs.block(loaderBlock, "loader", suite.name) : null,
			});
			if (!parsed.success) {
				throw new BadRequestError(
					`This ${refs.label ?? "route"} export is invalid: suites.${i}.input ${parsed.error.issues[0]!.message}`,
				);
			}
			suiteInput = parsed.data;
		}

		const suiteId = generateID();
		await createTestSuite(
			{
				...fields,
				...owner,
				id: suiteId,
				input: suiteInput,
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

/**
 * Creates the suites on `owner`. Custom blocks and integrations are matched to
 * the project's by name; what has no match is dropped and reported in `warnings`.
 */
export async function importSuites(
	owner: SuiteOwner,
	suites: BundleSuite[],
	{ projectId, blockIds, warnings, label }: ImportContext,
	tx: DbTransactionType,
): Promise<void> {
	if (suites.length === 0) return;
	const names = (pick: (s: BundleSuite) => (string | null | undefined)[]) =>
		suites.flatMap(pick).filter((n): n is string => !!n);
	const [customBlocks, integrations] = await Promise.all([
		idsByName(
			customBlocksListEntity,
			projectId,
			names((s) => [s.setupBlock, s.teardownBlock, s.input?.loaderBlock]),
		),
		idsByName(
			integrationsEntity,
			projectId,
			names((s) => s.integrationOverrides.flatMap((o) => [o.existing, o.replacement])),
		),
	]);
	await writeSuites(
		owner,
		suites,
		{
			label,
			block(name, role, suite) {
				const found = customBlocks.get(name);
				if (!found)
					warnings.push(
						`Test "${suite}": ${role} block "${name}" doesn't exist here and was dropped.`,
					);
				return found ?? null;
			},
			integration(o, suite) {
				const existingId = integrations.get(o.existing);
				const newId = integrations.get(o.replacement);
				if (existingId && newId) return { existingId, newId };
				warnings.push(
					`Test "${suite}": integration override ${o.existing} → ${o.replacement} was dropped.`,
				);
				return null;
			},
			canvasBlock: (id) => blockIds.get(id),
			warn: (message) => warnings.push(message),
		},
		tx,
	);
}
