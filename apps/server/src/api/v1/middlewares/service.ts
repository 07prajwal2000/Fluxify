import type { User } from "better-auth";
import { eq } from "drizzle-orm";
import type z from "zod";
import { db } from "../../../db";
import { type AuthACL, middlewaresEntity } from "../../../db/schema";
import { ConflictError } from "../../../errors/conflictError";
import { ForbiddenError } from "../../../errors/forbidError";
import { NotFoundError } from "../../../errors/notFoundError";
import { requestMiddlewareCompile } from "../../../modules/compiler/publisher";
import { hasProjectAccess } from "../../auth/common";
import type {
	createBodySchema,
	getResponseSchema,
	listResponseSchema,
	routeMiddlewaresBodySchema,
	routeMiddlewaresResponseSchema,
	updateBodySchema,
} from "./dto";
import {
	getChain,
	getMiddleware,
	getRouteMiddlewares,
	getRouteProject,
	listChains,
	listMiddlewares,
	nameTaken,
	recompileRoutes,
	routeCounts,
	routesUsing,
	setChain,
	setRouteMiddlewares,
} from "./repository";

type Caller = { user: User & { isSystemAdmin: boolean }; acl: AuthACL[] };
type Role = "viewer" | "creator";

function assertAccess({ user, acl }: Caller, projectId: string | null | undefined, role: Role) {
	if (!projectId || !hasProjectAccess(user, acl, projectId, role)) throw new ForbiddenError();
}

async function middlewareFor(id: string, caller: Caller, role: Role) {
	const middleware = await getMiddleware(id);
	if (!middleware) throw new NotFoundError("Middleware not found");
	assertAccess(caller, middleware.projectId, role);
	return middleware;
}

/** the route's project, once the caller may act on it */
async function routeFor(routeId: string, caller: Caller, role: Role) {
	const projectId = await getRouteProject(routeId);
	if (!projectId) throw new NotFoundError("Route not found");
	assertAccess(caller, projectId, role);
	return projectId;
}

export async function list(projectId: string): Promise<z.infer<typeof listResponseSchema>> {
	const [rows, chains, counts] = await Promise.all([
		listMiddlewares(projectId),
		listChains(projectId),
		routeCounts(projectId),
	]);
	return rows.map((row) => ({
		...row,
		updatedAt: row.updatedAt.toISOString(),
		blocks: chains.filter((c) => c.middlewareId === row.id).map(({ middlewareId, ...b }) => b),
		routeCount: counts.find((c) => c.middlewareId === row.id)?.count ?? 0,
	}));
}

export async function get(id: string, caller: Caller): Promise<z.infer<typeof getResponseSchema>> {
	const middleware = await middlewareFor(id, caller, "viewer");
	return {
		id: middleware.id,
		projectId: middleware.projectId,
		name: middleware.name,
		description: middleware.description,
		blocks: await getChain(id),
	};
}

export async function create(data: z.infer<typeof createBodySchema>) {
	const row = await db.transaction(async (tx) => {
		await nameTaken(data.projectId, data.name, undefined, tx);
		const { blocks, ...fields } = data;
		const [row] = await tx
			.insert(middlewaresEntity)
			.values(fields)
			.returning({ id: middlewaresEntity.id });
		if (blocks?.length) await setChain(row!.id, data.projectId, blocks, tx);
		return row!;
	});
	// its own artifact (#579); it is on no route yet, so no route recompiles
	await requestMiddlewareCompile(row.id, data.projectId, "middleware created");
	return row;
}

export async function update(id: string, data: z.infer<typeof updateBodySchema>, caller: Caller) {
	const middleware = await middlewareFor(id, caller, "creator");
	await db.transaction(async (tx) => {
		if (data.name) await nameTaken(middleware.projectId, data.name, id, tx);
		const { blocks, ...fields } = data;
		if (Object.keys(fields).length) {
			await tx.update(middlewaresEntity).set(fields).where(eq(middlewaresEntity.id, id));
		}
		if (blocks) await setChain(id, middleware.projectId, blocks, tx);
	});
	// name and chain live in the middleware's own artifact (#579), not in the
	// routes: one small write, however many routes use it
	await requestMiddlewareCompile(id, middleware.projectId, "middleware changed");
	return { id };
}

export async function remove(id: string, caller: Caller) {
	const middleware = await middlewareFor(id, caller, "creator");
	// Refused, not detached for the user (#579): a route artifact names its
	// middlewares by id, and nothing orders this artifact's drop after those
	// routes' rebuilds. A route whose rebuild failed would keep naming it and
	// fail every request.
	const routes = await routesUsing(id);
	if (routes.length) {
		throw new ConflictError(
			`Remove this middleware from the ${routes.length} route${routes.length === 1 ? "" : "s"} that use it first.`,
		);
	}
	await db.delete(middlewaresEntity).where(eq(middlewaresEntity.id, id));
	await requestMiddlewareCompile(id, middleware.projectId, "middleware deleted");
	return { id };
}

export async function getForRoute(
	routeId: string,
	caller: Caller,
): Promise<z.infer<typeof routeMiddlewaresResponseSchema>> {
	await routeFor(routeId, caller, "viewer");
	const rows = await getRouteMiddlewares(routeId);
	const pick = (phase: string) =>
		rows
			.filter((r) => r.phase === phase)
			.map(({ id, name, description }) => ({ id, name, description }));
	return { before: pick("before"), after: pick("after") };
}

export async function setForRoute(
	routeId: string,
	data: z.infer<typeof routeMiddlewaresBodySchema>,
	caller: Caller,
) {
	const projectId = await routeFor(routeId, caller, "creator");
	await db.transaction((tx) => setRouteMiddlewares(routeId, projectId, data, tx));
	await recompileRoutes([routeId]);
	return { id: routeId };
}
