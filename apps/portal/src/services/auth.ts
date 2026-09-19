import {
	requestBodySchema as createUserRequestBodySchema,
	type responseSchema as createUserResponseSchema,
} from "@fluxify/server/src/api/auth/create-user/dto";
import type { responseSchema as deleteUserResponseSchema } from "@fluxify/server/src/api/auth/delete-user/dto";
import {
	requestBodySchema as listUsersRequestBodySchema,
	type responseSchema as listUsersResponseSchema,
} from "@fluxify/server/src/api/auth/list-users/dto";
import type {
	requestBodySchema as updateUserPartialBodySchema,
	responseSchema as updateUserPartialResponseSchema,
} from "@fluxify/server/src/api/auth/update-user-partial/dto";
import type { z } from "zod";
import { httpClient } from "@/lib/http";

export const authService = {
	async listUsers(
		query: z.infer<typeof listUsersRequestBodySchema>,
	): Promise<z.infer<typeof listUsersResponseSchema>> {
		const params = new URLSearchParams();
		if (query?.page) params.set("page", query.page.toString());
		if (query?.perPage) params.set("perPage", query.perPage.toString());
		if (query?.fuzzySearch) params.set("fuzzySearch", query.fuzzySearch.toString());
		const result = await httpClient.get("/auth/list-users", { params });
		return result.data;
	},
	async createUser(
		body: z.infer<typeof createUserRequestBodySchema>,
	): Promise<z.infer<typeof createUserResponseSchema>> {
		const result = await httpClient.post("/auth/create-user", body);
		return result.data;
	},
	async updateUserPartial(
		userId: string,
		body: z.infer<typeof updateUserPartialBodySchema>,
	): Promise<z.infer<typeof updateUserPartialResponseSchema>> {
		const result = await httpClient.patch(`/auth/update-user/${userId}`, body);
		return result.data;
	},
	async deleteUser(userId: string): Promise<z.infer<typeof deleteUserResponseSchema>> {
		const result = await httpClient.delete(`/auth/delete-user/${userId}`);
		return result.data;
	},
	async changeUserPassword(
		userId: string,
		body: { newPassword: string },
	): Promise<{ message: string }> {
		const result = await httpClient.patch(`/auth/change-user-password/${userId}`, body);
		return result.data;
	},
	listUsersRequestBodySchema,
	createUserRequestBodySchema,
};
