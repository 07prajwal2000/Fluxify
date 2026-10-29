import { generateID } from "@fluxify/lib";
import { and, eq, inArray } from "drizzle-orm";
import { setRouteMiddlewares } from "../../api/v1/middlewares/repository";
import { requestBodySchema } from "../../api/v1/routes/create/dto";
import createRoute from "../../api/v1/routes/create/service";
import { createTestSuite } from "../../api/v1/test-suites/create/repository";
import { db } from "../../db";
import { CHAN_ON_ROUTE_CHANGE, publishMessage } from "../../db/redis";
import { customBlocksListEntity, integrationsEntity, middlewaresEntity } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { saveCanvas } from "../canvas/service";
import { upsertResponseSchema } from "../responseSchemas/repository";
import { replaceSuiteHooks } from "../testRunner/hooks";
import {
	migrateBundle,
	ROUTE_BUNDLE_KIND,
	ROUTE_BUNDLE_VERSION,
	type RouteBundle,
	routeBundleSchema,
} from "./bundle";

/** Reads untrusted input into a bundle, or says why it is not one. */
export function parseBundle(raw: unknown): RouteBundle {
	const doc = raw as Record<string, unknown> | null;
	if (!doc || typeof doc !== "object" || doc.kind !== ROUTE_BUNDLE_KIND) {
		throw new BadRequestError("That isn't a Fluxify route export.");
	}
	if (typeof doc.version !== "number" || !Number.isInteger(doc.version)) {
		throw new BadRequestError("This route export has no usable version.");
	}
	if (doc.version > ROUTE_BUNDLE_VERSION) {
		throw new BadRequestError(
			`This route was exported by a newer version of Fluxify (v${doc.version}). Update to import it.`,
		);
	}
	const parsed = routeBundleSchema.safeParse(migrateBundle(doc));
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new BadRequestError(
			`This route export is invalid: ${issue.path.join(".")} ${issue.message}`,
		);
	}
	return parsed.data;
}

type Lookup = Map<string, string>;

/** name → id of the project's rows of `table`, for the names asked for */
async function idsByName(
	table: typeof middlewaresEntity | typeof customBlocksListEntity | typeof integrationsEntity,
	projectId: string,
	names: string[],
): Promise<Lookup> {
	if (names.length === 0) return new Map();
	const rows = await db
		.select({ id: table.id, name: table.name })
		.from(table)
		.where(and(eq(table.projectId, projectId), inArray(table.name, names)));
	return new Map(rows.map((r) => [r.name ?? "", r.id]));
}

/**
 * Creates the route, its canvas, response schemas, middlewares and tests from a
 * bundle, in one transaction. Middlewares, custom blocks and integrations are
 * matched to the project's by name; what has no match is dropped and reported
 * in `warnings`. The route is created off in production: it answers in
 * development until someone promotes it.
 */
export async function importRouteBundle(userId: string, projectId: string, raw: unknown) {
	const bundle = parseBundle(raw);
	const warnings: string[] = [];

	const created = requestBodySchema.safeParse({ ...bundle.route, projectId, active: false });
	if (!created.success) {
		throw new BadRequestError(`This route export is invalid: ${created.error.issues[0]!.message}`);
	}

	const suites = bundle.suites ?? [];
	const names = (pick: (s: (typeof suites)[number]) => (string | null | undefined)[]) =>
		suites.flatMap(pick).filter((n): n is string => !!n);
	const [middlewares, customBlocks, integrations] = await Promise.all([
		idsByName(middlewaresEntity, projectId, [
			...bundle.middlewares.before,
			...bundle.middlewares.after,
		]),
		idsByName(
			customBlocksListEntity,
			projectId,
			names((s) => [s.setupBlock, s.teardownBlock]),
		),
		idsByName(
			integrationsEntity,
			projectId,
			names((s) => s.integrationOverrides.flatMap((o) => [o.existing, o.replacement])),
		),
	]);
	const matched = (phase: string[]) =>
		phase.filter((n) => {
			if (middlewares.has(n)) return true;
			warnings.push(`Middleware "${n}" doesn't exist in this project and was not attached.`);
			return false;
		});

	// fresh ids: block and edge ids are unique across every canvas
	const blockIds = new Map(bundle.canvas.blocks.map((b) => [b.id, generateID()]));
	const newId = (id: string) => blockIds.get(id) ?? id;

	const routeId = await db.transaction(async (tx) => {
		const { id } = await createRoute(userId, created.data, tx, undefined, false);

		const blocks = bundle.canvas.blocks.map((b) => ({ ...b, id: newId(b.id) }));
		// edge ids are remapped too: the ids of the source route are still taken
		const edges = bundle.canvas.edges.map((e) => ({
			...e,
			id: generateID(),
			from: newId(e.from),
			to: newId(e.to),
			fromHandle: e.fromHandle?.replaceAll(e.from, newId(e.from)),
			toHandle: e.toHandle?.replaceAll(e.to, newId(e.to)),
		}));
		await saveCanvas(
			{ type: "route", id },
			{
				actionsToPerform: {
					blocks: blocks.map((b) => ({ id: b.id, action: "upsert" as const })),
					edges: edges.map((e) => ({ id: e.id, action: "upsert" as const })),
				},
				changes: { blocks, edges },
			},
			[projectId],
			tx,
		);

		for (const { statusCode, schema } of bundle.responseSchemas) {
			await upsertResponseSchema(id, statusCode, schema, tx);
		}

		const phases = {
			before: matched(bundle.middlewares.before).map((n) => middlewares.get(n)!),
			after: matched(bundle.middlewares.after).map((n) => middlewares.get(n)!),
		};
		await setRouteMiddlewares(id, projectId, phases, tx);

		for (const suite of suites) {
			const {
				hooks,
				integrationOverrides,
				appConfigOverrideKeys,
				setupBlock,
				teardownBlock,
				...fields
			} = suite;
			const blockOf = (name: string | null | undefined, role: string) => {
				if (!name) return null;
				const found = customBlocks.get(name);
				if (!found)
					warnings.push(
						`Test "${suite.name}": ${role} block "${name}" doesn't exist here and was dropped.`,
					);
				return found ?? null;
			};
			const suiteId = generateID();
			await createTestSuite(
				{
					...fields,
					id: suiteId,
					routeId: id,
					setupBlockId: blockOf(setupBlock, "setup"),
					teardownBlockId: blockOf(teardownBlock, "teardown"),
					integrationOverrides: integrationOverrides.flatMap((o) => {
						const existingId = integrations.get(o.existing);
						const replacementId = integrations.get(o.replacement);
						if (existingId && replacementId) return [{ existingId, newId: replacementId }];
						warnings.push(
							`Test "${suite.name}": integration override ${o.existing} → ${o.replacement} was dropped.`,
						);
						return [];
					}),
					// values are never exported, so there is nothing to restore but the names
					appConfigOverrides: [],
				},
				tx,
			);
			if (appConfigOverrideKeys.length) {
				warnings.push(
					`Test "${suite.name}": set the values of the app config overrides ${appConfigOverrideKeys.join(", ")}.`,
				);
			}
			// ponytail: hooks are not re-run through validateHooks (it reads outside this transaction); the exporting server already validated them
			const remapped = hooks.flatMap((h) =>
				blockIds.has(h.blockId) ? [{ ...h, blockId: newId(h.blockId) }] : [],
			);
			if (remapped.length < hooks.length) {
				warnings.push(
					`Test "${suite.name}": ${hooks.length - remapped.length} block hook(s) had no block and were dropped.`,
				);
			}
			await replaceSuiteHooks(suiteId, remapped, tx);
		}
		return id;
	});

	await publishMessage(CHAN_ON_ROUTE_CHANGE, routeId);
	return { id: routeId, warnings };
}
