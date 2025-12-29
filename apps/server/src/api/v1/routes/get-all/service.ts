import z from "zod";
import { requestQuerySchema, responseSchema } from "./dto";
import { getRoutesList } from "./repository";
import {
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  lt,
  lte,
  ne,
  SQL,
  sql,
} from "drizzle-orm";
import { AuthACL, routesEntity } from "../../../../db/schema";

export default async function handleRequest(
  query: z.infer<typeof requestQuerySchema>,
  acl: AuthACL[] = []
): Promise<z.infer<typeof responseSchema>> {
  const offset = query.perPage * (query.page - 1);
  const projectIds = acl.map((a) => a.projectId);
  const isSystemAdmin = acl.some((a) => a.projectId === "*");
  const filter = generateFilterSQL(query);
  const filterSQL = and(
    filter,
    isSystemAdmin ? undefined : inArray(routesEntity.projectId, projectIds)
  );
  const { result, totalCount } = await getRoutesList(
    offset,
    query.perPage,
    filterSQL
  );
  const hasNext = offset + result.length < totalCount;
  return {
    pagination: {
      hasNext,
      page: query.page,
      totalPages: Math.ceil(totalCount / query.perPage),
    },
    data: result.map((value) => ({
      id: value.id!,
      active: value.active!,
      name: value.name!,
      method: value.method!,
      path: value.path!,
      projectId: value.projectId!,
      projectName: value.projectName!,
      createdAt: value.createdAt.toISOString(),
      updatedAt: value.updatedAt.toISOString(),
    })),
  };
}

function generateFilterSQL(query?: z.infer<typeof requestQuerySchema>): SQL {
  const filter = query?.filter;
  if (filter?.projectId !== undefined) {
    const projectId = filter.projectId;
    filter.projectId = undefined;
    return and(
      eq(routesEntity.projectId, projectId),
      generateFilterSQL(query)
    )!;
  }
  if (!filter) return sql`1=1`;
  if (!filter.field) return sql`1=1`;
  const field = routesEntity[filter.field];

  if (!filter.operator) return sql`1=1`;
  if (!filter.value) return sql`1=1`;
  if (!field) return sql`1=1`;
  let value: any = filter.value;
  if (value === "true") value = true;
  else if (value === "false") value = false;
  else if (!isNaN(Number(value))) value = Number(value);

  if (filter.operator == "eq" && typeof value === "string")
    return ilike(field, filter.value);
  else if (filter.operator == "eq") return eq(field, value);
  else if (filter.operator == "neq") return ne(field, filter.value);
  else if (filter.operator == "gt") return gt(field, filter.value);
  else if (filter.operator == "gte") return gte(field, filter.value);
  else if (filter.operator == "lt") return lt(field, filter.value);
  else if (filter.operator == "lte") return lte(field, filter.value);
  else if (filter.operator == "like") return ilike(field, `%${filter.value}%`);
  else return sql`1=1`;
}
