import type { z } from "zod";
import { httpClient } from "@/lib/http";
import * as findResourceDto from "@fluxify/ai-gateway/src/api/v1/find-resource/dto";

const baseUrl = (projectId: string) => `ai/v1/${projectId}/find-resource`;

export type FindResourceResult = z.infer<typeof findResourceDto.resultSchema>;
export type FindResourceResponse = z.infer<typeof findResourceDto.responseSchema>;

export const findResourceService = {
	/** Free-text lookup over routes, integrations and app configs. The whole
	 *  phrase is one term server-side, and results cap at 30. */
	async search(projectId: string, q: string): Promise<FindResourceResponse> {
		const params = new URLSearchParams({ q });
		const result = await httpClient.get(`${baseUrl(projectId)}?${params}`);
		return result.data;
	},
	resultSchema: findResourceDto.resultSchema,
	responseSchema: findResourceDto.responseSchema,
};
