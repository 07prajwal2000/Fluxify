import { inferSchema } from "@fluxify/blocks/inferSchema";
import { ValidationSchemaZod } from "@fluxify/blocks/validationSchema";
import { db } from "../../db";
import type { AuthACL } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { ForbiddenError } from "../../errors/forbidError";
import { NotFoundError } from "../../errors/notFoundError";
import { canAccessProject } from "../../lib/acl";
import { audit } from "../audit";
import {
	bumpRevision,
	deleteResponseSchema,
	findRoute,
	listResponseSchemas,
	lockRoute,
	upsertResponseSchema,
} from "./repository";

/** `sample` is a captured response body, `schema` an already-built one. Exactly one. */
export type PutInput = { schema?: unknown; sample?: unknown };

const present = (row: { statusCode: number; schema: unknown; updatedAt: Date }) => ({
	statusCode: row.statusCode,
	schema: row.schema,
	updatedAt: row.updatedAt.toISOString(),
});

/** The development spec is cached for an hour and lists these, so an edit drops it. */
async function refreshSpec(projectId: string | null) {
	if (!projectId) return;
	const { invalidateOpenApiCache } = await import("../../api/v1/routes/openapi/service");
	await invalidateOpenApiCache(projectId, "development");
}

export async function listForRoute(routeId: string, acl: AuthACL[]) {
	const route = await findRoute(routeId);
	if (!route) throw new NotFoundError("Route not found");
	if (!canAccessProject(acl, route.projectId ?? "", "viewer")) throw new ForbiddenError();
	return (await listResponseSchemas(routeId)).map(present);
}

export async function putForRoute(
	routeId: string,
	statusCode: number,
	input: PutInput,
	acl: AuthACL[],
) {
	// a sample of `null` is a legal JSON body, so test for the key, not truthiness
	const hasSample = "sample" in input;
	if (hasSample === "schema" in input) {
		throw new BadRequestError("Send exactly one of `schema` or `sample`");
	}
	const parsed = hasSample
		? inferSchema(input.sample)
		: ValidationSchemaZod.safeParse(input.schema);
	if ("success" in parsed && !parsed.success) {
		throw new BadRequestError("`schema` is not a valid schema");
	}
	const schema = ("success" in parsed ? parsed.data : parsed) as Record<string, unknown>;
	const { route, saved } = await db.transaction(async (tx) => {
		const route = await lockRoute(routeId, tx);
		if (!route) throw new NotFoundError("Route not found");
		if (!canAccessProject(acl, route.projectId ?? "", "creator")) throw new ForbiddenError();
		const saved = await upsertResponseSchema(routeId, statusCode, schema, tx);
		await bumpRevision(routeId, tx);
		await audit.record({
			projectId: route.projectId,
			resourceType: "route",
			resourceId: routeId,
			action: "update",
			changedFields: [`responseSchema.${statusCode}`],
		});
		return { route, saved: present(saved) };
	});
	await refreshSpec(route.projectId);
	return saved;
}

export async function deleteForRoute(routeId: string, statusCode: number, acl: AuthACL[]) {
	const projectId = await db.transaction(async (tx) => {
		const route = await lockRoute(routeId, tx);
		if (!route) throw new NotFoundError("Route not found");
		if (!canAccessProject(acl, route.projectId ?? "", "creator")) throw new ForbiddenError();
		if (!(await deleteResponseSchema(routeId, statusCode, tx))) {
			throw new NotFoundError(`No schema saved for status ${statusCode}`);
		}
		await bumpRevision(routeId, tx);
		await audit.record({
			projectId: route.projectId,
			resourceType: "route",
			resourceId: routeId,
			action: "update",
			changedFields: [`responseSchema.${statusCode}`],
		});
		return route.projectId;
	});
	await refreshSpec(projectId);
}
