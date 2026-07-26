import type z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/projects/settings/keys/get-all/dto";
import { httpClient } from "@/lib/http";

const base = (projectId: string) => `/v1/projects/${projectId}/settings/keys`;

export const projectSettingsKeysService = {
	async getAll(
		projectId: string,
	): Promise<z.infer<typeof getAllResponseSchema>> {
		const res = await httpClient.get(`${base(projectId)}`);
		return res.data;
	},
};
