import { requestBodySchema, responseSchema } from "./dto";
import { z } from "zod";
import { getUsers, getUsersCount } from "./repository";

export default async function handleRequest(
  query: z.infer<typeof requestBodySchema>
): Promise<z.infer<typeof responseSchema>> {
  const skip = query.perPage * (query.page - 1);
  const limit = query.perPage;
  const users = await getUsers(skip, limit);
  const totalCount = await getUsersCount();
  const hasNext = skip + users.length < totalCount;

  return {
    data: users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      isSystemAdmin: user.isSystemAdmin!,
      role: user.role as any,
    })),
    pagination: {
      hasNext,
      page: query.page,
      totalPages: Math.ceil(totalCount / query.perPage),
    },
  };
}
