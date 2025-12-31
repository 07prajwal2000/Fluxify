import z from "zod";
import { requestQuerySchema, responseSchema } from "./dto";
import { listProjectMembers } from "../repository";

export default async function handleRequest(
  projectId: string,
  query: z.infer<typeof requestQuerySchema>
): Promise<z.infer<typeof responseSchema>> {
  const skip = (query.page - 1) * query.perPage;
  const limit = query.perPage;
  const { result, totalCount } = await listProjectMembers(
    projectId,
    skip,
    limit,
    { role: query.role, name: query.name }
  );
  const hasNext = skip + result.length < totalCount;
  const totalPages = Math.ceil(totalCount / limit);
  return {
    data: result.map((r) => ({
      id: r.id!,
      name: r.name!,
      role: r.role!,
      userId: r.userId!,
      createdAt: r.createdAt!.toISOString(),
      updatedAt: r.updatedAt!.toISOString(),
    })),
    pagination: {
      page: query.page,
      totalPages,
      hasNext,
    },
  };
}
