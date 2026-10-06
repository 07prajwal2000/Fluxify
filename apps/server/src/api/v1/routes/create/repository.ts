import { BlockTypes } from "@fluxify/blocks";
import { STARTER_POSITIONS } from "@fluxify/blocks/layout";
import { generateID } from "@fluxify/lib";
import { and, eq, or } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import type z from "zod";
import { type DbTransactionType, db } from "../../../../db";
import { blocksEntity, type HttpMethod, projectsEntity, routesEntity } from "../../../../db/schema";

const insertSchema = createInsertSchema(routesEntity);

export async function createRoute(data: z.infer<typeof insertSchema>, tx?: DbTransactionType) {
	const newRoute = await (tx ?? db).insert(routesEntity).values(data).returning();
	return newRoute[0].id;
}

export async function createDependency(routeId: string, tx?: DbTransactionType) {
	const id1 = generateID();
	const id2 = generateID();
	const id3 = generateID();
	await (tx ?? db)?.insert(blocksEntity).values({
		routeId,
		type: "entrypoint",
		position: STARTER_POSITIONS.entrypoint,
		data: {},
		id: id1,
	});
	await (tx ?? db)?.insert(blocksEntity).values({
		id: id2,
		routeId,
		type: "response",
		position: STARTER_POSITIONS.response,
		data: {
			httpCode: "200",
		},
	});
	await (tx ?? db)?.insert(blocksEntity).values({
		id: id3,
		routeId,
		type: BlockTypes.errorHandler,
		position: STARTER_POSITIONS.errorHandler,
		data: {
			next: "",
			retryAfterFail: false,
			retryCount: 0,
		},
	});
}

export async function checkRouteExist(
	name: string,
	path: string,
	method: HttpMethod,
	tx?: DbTransactionType,
) {
	const exist = await (tx ?? db)
		.select({ id: routesEntity.id })
		.from(routesEntity)
		.where(
			or(
				eq(routesEntity.name, name),
				and(eq(routesEntity.path, path), eq(routesEntity.method, method)),
			),
		)
		.limit(1);
	return exist.length > 0;
}

export async function checkProjectExist(id: string, tx?: DbTransactionType) {
	const project = await (tx ?? db)
		.select({ id: projectsEntity.id })
		.from(projectsEntity)
		.where(eq(projectsEntity.id, id))
		.limit(1);
	return project.length > 0;
}
