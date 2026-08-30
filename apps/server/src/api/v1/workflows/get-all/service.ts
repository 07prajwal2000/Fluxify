import { z } from "zod";
import { and, eq, ilike, inArray, SQL, sql } from "drizzle-orm";
import { AuthACL, workflowsEntity } from "../../../../db/schema";
import { present } from "../shared";
import { requestQuerySchema, responseSchema } from "./dto";
import { listWorkflows } from "./repository";

export default async function handleRequest(
	query: z.infer<typeof requestQuerySchema>,
	acl: AuthACL[] = [],
): Promise<z.infer<typeof responseSchema>> {
	const offset = query.perPage * (query.page - 1);
	const isSystemAdmin = acl.some((a) => a.projectId === "*");
	const filters: (SQL | undefined)[] = [
		isSystemAdmin
			? undefined
			: inArray(
					workflowsEntity.projectId,
					acl.map((a) => a.projectId),
				),
		query.projectId ? eq(workflowsEntity.projectId, query.projectId) : undefined,
		query.active === undefined
			? undefined
			: eq(workflowsEntity.active, query.active),
		query.search ? ilike(workflowsEntity.name, `%${query.search}%`) : undefined,
	];
	const filter = and(...filters.filter(Boolean)) ?? sql`1=1`;

	const { result, totalCount } = await listWorkflows(offset, query.perPage, filter);
	return {
		pagination: {
			page: query.page,
			totalPages: Math.ceil(totalCount / query.perPage),
			hasNext: offset + result.length < totalCount,
		},
		data: result.map((row) => ({
			...present(row),
			projectName: row.projectName ?? "",
		})),
	};
}
