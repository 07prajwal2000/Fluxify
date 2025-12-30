import { z } from "zod";
import { requestBodySchema as listUsersRequestBodySchema } from "@fluxify/server/src/api/auth/list-users/dto";
import { responseSchema as listUsersResponseSchema } from "@fluxify/server/src/api/auth/list-users/dto";
import { requestBodySchema as createUserRequestBodySchema } from "@fluxify/server/src/api/auth/create-user/dto";
import { responseSchema as createUserResponseSchema } from "@fluxify/server/src/api/auth/create-user/dto";
import { requestBodySchema as updateUserPartialBodySchema } from "@fluxify/server/src/api/auth/update-user-partial/dto";
import { responseSchema as updateUserPartialResponseSchema } from "@fluxify/server/src/api/auth/update-user-partial/dto";
import { responseSchema as deleteUserResponseSchema } from "@fluxify/server/src/api/auth/delete-user/dto";
import { httpClient } from "@/lib/http";

export const authService = {
  async listUsers(
    query: z.infer<typeof listUsersRequestBodySchema>
  ): Promise<z.infer<typeof listUsersResponseSchema>> {
    const queryParams = new URLSearchParams();
    if (query?.page) {
      queryParams.set("page", query.page.toString());
    }
    if (query?.perPage) {
      queryParams.set("perPage", query.perPage.toString());
    }
    const result = await httpClient.get("/auth/list-users", {
      params: queryParams,
    });
    return result.data;
  },
  async createUser(
    body: z.infer<typeof createUserRequestBodySchema>
  ): Promise<z.infer<typeof createUserResponseSchema>> {
    const result = await httpClient.post("/auth/create-user", body);
    return result.data;
  },
  async updateUserPartial(
    userId: string,
    body: z.infer<typeof updateUserPartialBodySchema>
  ): Promise<z.infer<typeof updateUserPartialResponseSchema>> {
    const result = await httpClient.patch(`/auth/update-user/${userId}`, body);
    return result.data;
  },
  async deleteUser(
    userId: string
  ): Promise<z.infer<typeof deleteUserResponseSchema>> {
    const result = await httpClient.delete(`/auth/delete-user/${userId}`);
    return result.data;
  },
  listUsersRequestBodySchema,
  createUserRequestBodySchema,
};
