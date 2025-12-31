import { httpClient } from "@/lib/http";
import z from "zod";
import {
  requestQuerySchema as listRequestQuerySchema,
  responseSchema as listResponseSchema,
} from "@fluxify/server/src/api/v1/projects/settings/members/list/dto";
import {
  requestBodySchema as addRequestBodySchema,
  responseSchema as addResponseSchema,
} from "@fluxify/server/src/api/v1/projects/settings/members/add/dto";
import {
  requestBodySchema as updateRequestBodySchema,
  responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/projects/settings/members/update/dto";

export const projectMembersService = {
  async list(
    projectId: string,
    query: z.infer<typeof listRequestQuerySchema>
  ): Promise<z.infer<typeof listResponseSchema>> {
    const params = new URLSearchParams();
    params.set("page", String(query?.page ?? 1));
    params.set("perPage", String(query?.perPage ?? 10));
    if (query?.role) params.set("role", query.role);
    if (query?.name) params.set("name", query.name);
    const res = await httpClient.get(
      `/v1/projects/${projectId}/settings/members/list?${params.toString()}`
    );
    return res.data;
  },
  async add(
    projectId: string,
    body: z.infer<typeof addRequestBodySchema>
  ): Promise<z.infer<typeof addResponseSchema>> {
    const { success } = addRequestBodySchema.safeParse(body);
    if (!success) throw new Error("Invalid add body");
    const res = await httpClient.post(
      `/v1/projects/${projectId}/settings/members/add`,
      body
    );
    return res.data;
  },
  async update(
    projectId: string,
    userId: string,
    body: z.infer<typeof updateRequestBodySchema>
  ): Promise<z.infer<typeof updateResponseSchema>> {
    const { success } = updateRequestBodySchema.safeParse(body);
    if (!success) throw new Error("Invalid update body");
    const res = await httpClient.put(
      `/v1/projects/${projectId}/settings/members/update/${userId}`,
      body
    );
    return res.data;
  },
  async remove(projectId: string, userId: string): Promise<void> {
    await httpClient.delete(
      `/v1/projects/${projectId}/settings/members/remove/${userId}`
    );
  },
  listRequestQuerySchema,
  addRequestBodySchema,
  updateRequestBodySchema,
};
