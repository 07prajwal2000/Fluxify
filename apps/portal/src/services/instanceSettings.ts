import z from "zod";
import { responseSchema as getAllResponseSchema } from "@fluxify/server/src/api/v1/instance-settings/get-all/dto";
import { requestBodySchema as upsertRequestBodySchema } from "@fluxify/server/src/api/v1/instance-settings/upsert/dto";
import { responseSchema as getAuthResponseSchema } from "@fluxify/server/src/api/v1/instance-settings/get-auth-settings/dto";
import {
	requestBodySchema as patchAuthRequestBodySchema,
	responseSchema as patchAuthResponseSchema,
} from "@fluxify/server/src/api/v1/instance-settings/patch-auth-settings/dto";
import type {
	LicenseView,
	setLicenseBodySchema,
} from "@fluxify/server/src/api/v1/instance-settings/license/dto";
import { httpClient } from "@/lib/http";

export type { LicenseView };
export type SetLicenseBody = z.infer<typeof setLicenseBodySchema>;

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
	async getAuth(): Promise<z.infer<typeof getAuthResponseSchema>> {
		const result = await httpClient.get(`${baseUrl}/auth`);
		return result.data;
	},
	async patchAuth(
		body: z.infer<typeof patchAuthRequestBodySchema>,
	): Promise<z.infer<typeof patchAuthResponseSchema>> {
		const result = await httpClient.patch(`${baseUrl}/auth`, body);
		return result.data;
	},
	async getLicense(): Promise<LicenseView> {
		const result = await httpClient.get(`${baseUrl}/license`);
		return result.data;
	},
	async setLicense(body: SetLicenseBody): Promise<LicenseView> {
		const result = await httpClient.put(`${baseUrl}/license`, body);
		return result.data;
	},
};
