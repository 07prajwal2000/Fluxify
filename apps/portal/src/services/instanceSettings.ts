import z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/instance-settings/get-all/dto";
import { requestBodySchema as upsertRequestBodySchema } from "@fluxify/server/src/api/v1/instance-settings/upsert/dto";
import { httpClient } from "@/lib/http";

const baseUrl = "/v1/instance-settings";

export const instanceSettingsService = {
	async getAll(): Promise<z.infer<typeof getAllResponseSchema>> {
		const result = await httpClient.get(baseUrl);
		return result.data;
	},
	async upsert(body: z.infer<typeof upsertRequestBodySchema>) {
		const result = await httpClient.put(baseUrl, body);
		return result.data;
	},
};
