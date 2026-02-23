import { httpClient } from "@/lib/http";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/projects/settings/keys/get-all/dto";
import {
  requestBodySchema as upsertRequestBodySchema,
  responseSchema as upsertResponseSchema,
} from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import z from "zod";

const getBaseUrl = (projectId: string) =>
  `/v1/projects/${projectId}/settings/keys`;

export const projectSettingsService = {
  async getAll(
    projectId: string,
  ): Promise<z.infer<typeof getAllResponseSchema>> {
    const url = getBaseUrl(projectId);
    const result = await httpClient.get(url);
    return result.data;
  },
  async upsert(
    projectId: string,
    data: z.infer<typeof upsertRequestBodySchema>,
  ): Promise<z.infer<typeof upsertResponseSchema>> {
    const { success } = upsertRequestBodySchema.safeParse(data);
    if (!success) {
      throw new Error("Invalid data for upsert project setting");
    }
    const url = getBaseUrl(projectId);
    const result = await httpClient.put(url, data);
    return result.data;
  },
  upsertRequestBodySchema,
};
