import z from "zod";
import {
  requestQuerySchema as getAllRequestQuerySchema,
  responseSchema as getAllResponseSchema,
} from "@fluxify/server/src/api/v1/routes/get-all/dto";
import {
  requestBodySchema as createRequestSchema,
  responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/routes/create/dto";
import {
  requestBodySchema as updateRequestSchema,
  responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/routes/update/dto";
import {
  requestBodySchema as updatePartialRequestSchema,
  responseSchema as updatePartialResponseSchema,
} from "@fluxify/server/src/api/v1/routes/update-partial/dto";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/routes/get-by-id/dto";
import { responseSchema as getCanvasItemsResponseSchema } from "@fluxify/server/src/api/v1/routes/get-canvas-items/dto";
import { requestBodySchema as saveCanvasItemsRequestSchema } from "@fluxify/server/src/api/v1/routes/save-canvas-state/dto";
import { httpClient } from "@/lib/http";

const baseUrl = `/v1/routes`;

export type GetAllRequestQueryType = z.infer<typeof getAllRequestQuerySchema>;
export const routesService = {
  async getAll(
    query: GetAllRequestQueryType
  ): Promise<z.infer<typeof getAllResponseSchema>> {
    const { data } = getAllRequestQuerySchema.safeParse(query);
    const filterParams = new URLSearchParams();
    if (query.filter.field && query.filter.value && query.filter.operator) {
      filterParams.append("filter.field", query.filter.field);
      filterParams.append("filter.value", query.filter.value);
      filterParams.append("filter.operator", query.filter.operator);
    }
    query.filter.projectId &&
      filterParams.append("projectId", query.filter.projectId);
    const result = await httpClient.get(
      `${baseUrl}/list?page=${data?.page ?? 1}&perPage=${
        data?.perPage ?? 10
      }&${filterParams.toString()}`
    );
    return result.data;
  },
  async getByID(id: string): Promise<z.infer<typeof getByIdResponseSchema>> {
    const result = await httpClient.get(`${baseUrl}/${id}`);
    return result.data;
  },
  async create(
    data: z.infer<typeof createRequestSchema>
  ): Promise<z.infer<typeof createResponseSchema>> {
    const result = await httpClient.post(`${baseUrl}`, data);
    return result.data;
  },
  async update(
    id: string,
    data: z.infer<typeof updateRequestSchema>
  ): Promise<z.infer<typeof updateResponseSchema>> {
    const result = await httpClient.put(`${baseUrl}/${id}`, data);
    return result.data;
  },
  async updatePartial(
    id: string,
    data: z.infer<typeof updatePartialRequestSchema>
  ): Promise<z.infer<typeof updatePartialResponseSchema>> {
    const result = await httpClient.patch(`${baseUrl}/partial/${id}`, data);
    return result.data;
  },
  async delete(id: string) {
    await httpClient.delete(`${baseUrl}/${id}`);
  },
  async getCanvasItems(
    routeId: string
  ): Promise<z.infer<typeof getCanvasItemsResponseSchema>> {
    const result = await httpClient.get(`${baseUrl}/${routeId}/canvas-items`);
    return result.data;
  },
  async saveCanvasItems(
    routeId: string,
    data: z.infer<typeof saveCanvasItemsRequestSchema>
  ) {
    await httpClient.put(`${baseUrl}/${routeId}/save-canvas`, data);
  },
  // zod schemas
  createRequestSchema,
  updateRequestSchema,
  updatePartialRequestSchema,
};
