import { z } from "zod";
import { requestQuerySchema, responseSchema } from "./dto";
import { getProjectsList } from "./repository";

export default async function handleRequest(
  query: z.infer<typeof requestQuerySchema>,
  projectsList: string[] = []
): Promise<z.infer<typeof responseSchema>> {
  const skip = query.perPage * (query.page - 1);
  const limit = query.perPage;
  const { data, totalCount } = await getProjectsList(skip, limit, projectsList);
  const hasNext = totalCount > skip + limit;
  const page = query.page;
  const totalPages = Math.ceil(totalCount / limit);

  return {
    data: data.map((project) => ({
      ...project,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    })),
    pagination: {
      hasNext,
      page,
      totalPages,
    },
  };
}
