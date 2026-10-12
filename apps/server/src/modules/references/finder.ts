import { and, eq, ne } from "drizzle-orm";
import { type DbTransactionType, db } from "../../db";
import {
	blocksEntity,
	customBlocksListEntity,
	middlewareBlocksEntity,
	middlewaresEntity,
	routeMiddlewaresEntity,
	routesEntity,
	workflowsEntity,
} from "../../db/schema";
import { loadProdGraph, type ProdGraph } from "./prodGraph";

/**
 * Who uses a custom block or a middleware (#740): the one answer behind the
 * "Used by" list and the delete guard.
 *
 * Sandboxes are not users. They are throwaway and belong to one person, so they
 * neither block a delete nor appear here; a sandbox that names a deleted block
 * fails when it runs, with a clear error.
 */

export type ReferenceKind = "route" | "workflow" | "custom_block" | "middleware" | "test_suite";

export type Reference = {
	kind: ReferenceKind;
	id: string;
	name: string;
	/** the user's promoted version uses it: a promote or rollback of the subject changes what runs */
	inProduction: boolean;
	/** the user's working copy uses it: development runs it */
	inWorkingCopy: boolean;
	/** a test suite's route or workflow */
	target?: { kind: "route" | "workflow"; id: string; name: string };
};

export type ReferenceSubject = {
	kind: "custom_block" | "middleware";
	id: string;
	name: string;
	projectId: string;
};

type Conn = DbTransactionType | typeof db;

/**
 * Every user of the subject, once: working copies of routes, workflows, other
 * custom blocks and middlewares, the promoted versions of those, and test suite
 * hooks. Direct uses only, as the list shows them; "uses of uses" is the gates'
 * business (see `prodUsers`).
 */
export async function findReferences(
	subject: ReferenceSubject,
	tx: Conn = db,
	graph?: ProdGraph,
): Promise<Reference[]> {
	const found = new Map<string, Reference>();
	const mark = (
		reference: Omit<Reference, "inProduction" | "inWorkingCopy">,
		where: "inProduction" | "inWorkingCopy",
	) => {
		const key = `${reference.kind}:${reference.id}`;
		const entry = found.get(key) ?? { ...reference, inProduction: false, inWorkingCopy: false };
		entry[where] = true;
		found.set(key, entry);
	};

	if (subject.kind === "custom_block") await workingCopiesOfBlock(subject, tx, mark);
	else await workingCopiesOfMiddleware(subject, tx, mark);

	const prod = graph ?? (await loadProdGraph(subject.projectId, tx));
	for (const entry of prod.entries.values()) {
		const uses =
			subject.kind === "custom_block"
				? entry.blockTypes.has(subject.name) ||
					(entry.kind === "middleware" && entry.chain.includes(subject.id))
				: entry.kind === "route" && entry.middlewares.includes(subject.id);
		if (!uses || (entry.kind === subject.kind && entry.id === subject.id)) continue;
		mark({ kind: entry.kind, id: entry.id, name: entry.name }, "inProduction");
	}

	// a suite's hooks run in its production runs too, once its target is promoted
	if (subject.kind === "custom_block") {
		for (const suite of prod.hookSuites) {
			if (!suite.blockIds.includes(subject.id)) continue;
			const { kind, id, name } = suite.target;
			const reference = {
				kind: "test_suite",
				id: suite.id,
				name: suite.name,
				target: { kind, id, name },
			} as const;
			mark(reference, "inWorkingCopy");
			if (suite.target.prodVersionId) mark(reference, "inProduction");
		}
	}
	return [...found.values()].sort(
		(a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
	);
}

type Mark = (
	reference: Omit<Reference, "inProduction" | "inWorkingCopy">,
	where: "inProduction" | "inWorkingCopy",
) => void;

/** a block instance's type is the custom block's name, so the canvases name it that way */
async function workingCopiesOfBlock(subject: ReferenceSubject, tx: Conn, mark: Mark) {
	const [routes, workflows, blocks, chains] = await Promise.all([
		tx
			.selectDistinct({ id: routesEntity.id, name: routesEntity.name })
			.from(blocksEntity)
			.innerJoin(routesEntity, eq(routesEntity.id, blocksEntity.routeId))
			.where(
				and(eq(blocksEntity.type, subject.name), eq(routesEntity.projectId, subject.projectId)),
			),
		tx
			.selectDistinct({ id: workflowsEntity.id, name: workflowsEntity.name })
			.from(blocksEntity)
			.innerJoin(workflowsEntity, eq(workflowsEntity.id, blocksEntity.workflowId))
			.where(
				and(eq(blocksEntity.type, subject.name), eq(workflowsEntity.projectId, subject.projectId)),
			),
		tx
			.selectDistinct({ id: customBlocksListEntity.id, name: customBlocksListEntity.name })
			.from(blocksEntity)
			.innerJoin(customBlocksListEntity, eq(customBlocksListEntity.id, blocksEntity.customBlockId))
			.where(
				and(
					eq(blocksEntity.type, subject.name),
					eq(customBlocksListEntity.projectId, subject.projectId),
					ne(customBlocksListEntity.id, subject.id),
				),
			),
		tx
			.select({ id: middlewaresEntity.id, name: middlewaresEntity.name })
			.from(middlewareBlocksEntity)
			.innerJoin(middlewaresEntity, eq(middlewaresEntity.id, middlewareBlocksEntity.middlewareId))
			.where(eq(middlewareBlocksEntity.customBlockId, subject.id)),
	]);
	for (const row of routes)
		mark({ kind: "route", id: row.id, name: row.name ?? row.id }, "inWorkingCopy");
	for (const row of workflows)
		mark({ kind: "workflow", id: row.id, name: row.name ?? row.id }, "inWorkingCopy");
	for (const row of blocks)
		mark({ kind: "custom_block", id: row.id, name: row.name }, "inWorkingCopy");
	for (const row of chains)
		mark({ kind: "middleware", id: row.id, name: row.name }, "inWorkingCopy");
}

async function workingCopiesOfMiddleware(subject: ReferenceSubject, tx: Conn, mark: Mark) {
	const routes = await tx
		.select({ id: routesEntity.id, name: routesEntity.name })
		.from(routeMiddlewaresEntity)
		.innerJoin(routesEntity, eq(routesEntity.id, routeMiddlewaresEntity.routeId))
		.where(eq(routeMiddlewaresEntity.middlewareId, subject.id));
	for (const row of routes)
		mark({ kind: "route", id: row.id, name: row.name ?? row.id }, "inWorkingCopy");
}

/** One line for an error or a gate: `route "orders" (id)`. */
export function describeReference(reference: Reference) {
	const label = reference.kind === "test_suite" ? "test suite" : reference.kind.replace("_", " ");
	const of = reference.target ? ` of ${reference.target.kind} "${reference.target.name}"` : "";
	return `${label} "${reference.name}"${of} (${reference.id})`;
}
