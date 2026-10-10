import type { responseSchema } from "@fluxify/server/src/api/v1/projects/settings/dev-token/route";
import type z from "zod";
import { httpClient } from "@/lib/http";

const base = (projectId: string) => `/v1/projects/${projectId}/settings/dev-token`;

type DevToken = z.infer<typeof responseSchema>;

export const projectDevTokenService = {
	async get(projectId: string): Promise<DevToken> {
		return (await httpClient.get(base(projectId))).data;
	},
	async rotate(projectId: string): Promise<DevToken> {
		return (await httpClient.post(`${base(projectId)}/rotate`)).data;
	},
};
