import z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-all/dto";
import {
  requestBodySchema as createRequestSchema,
  responseSchema as createResponseSchema,
} from "@fluxify/server/src/api/v1/test-suites/create/dto";
import {
  requestBodySchema as updateRequestSchema,
  responseSchema as updateResponseSchema,
} from "@fluxify/server/src/api/v1/test-suites/update/dto";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/test-suites/get-by-id/dto";
import { responseSchema as runResponseSchema } from "@fluxify/server/src/api/v1/test-suites/run/dto";
import { responseSchema as runAllResponseSchema } from "@fluxify/server/src/api/v1/test-suites/run-all/dto";
import { httpClient } from "@/lib/http";

const baseUrl = `/v1/test-suites`;

export const testSuitesService = {
  async getAll(routeId: string): Promise<z.infer<typeof getAllResponseSchema>> {
    const result = await httpClient.get(`${baseUrl}?route_id=${routeId}`);
    return result.data;
  },
  async getByID(id: string): Promise<z.infer<typeof getByIdResponseSchema>> {
    const result = await httpClient.get(`${baseUrl}/${id}`);
    return result.data;
  },
  async create(
    data: z.infer<typeof createRequestSchema>,
  ): Promise<z.infer<typeof createResponseSchema>> {
    const result = await httpClient.post(`${baseUrl}`, data);
    return result.data;
  },
  async update(
    id: string,
    data: z.infer<typeof updateRequestSchema>,
  ): Promise<z.infer<typeof updateResponseSchema>> {
    const result = await httpClient.put(`${baseUrl}/${id}`, data);
    return result.data;
  },
  async delete(id: string) {
    await httpClient.delete(`${baseUrl}/${id}`);
  },
  async run(id: string): Promise<z.infer<typeof runResponseSchema>> {
    const result = await httpClient.post(`${baseUrl}/${id}/run`, undefined, {
      validateStatus: (status) => status < 500,
    });
    return result.data;
  },
  async runAll(routeId: string): Promise<z.infer<typeof runAllResponseSchema>> {
    const result = await httpClient.post(
      `${baseUrl}/run-all?route_id=${routeId}`,
      undefined,
      {
        validateStatus: (status) => status < 500,
      },
    );
    return result.data;
  },
};
