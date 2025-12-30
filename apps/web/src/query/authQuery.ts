import { useQuery, useMutation, QueryClient } from "@tanstack/react-query";
import { authService } from "../services/auth";
import { z } from "zod";

export const authQuery = {
  listUsers: {
    useQuery: (
      query: z.infer<typeof authService.listUsersRequestBodySchema>
    ) => {
      return useQuery({
        queryKey: ["auth", "list-users", query],
        queryFn: () => authService.listUsers(query),
        refetchOnWindowFocus: false,
      });
    },
    invalidate(
      query: z.infer<typeof authService.listUsersRequestBodySchema>,
      queryClient: QueryClient
    ) {
      queryClient.invalidateQueries({
        queryKey: ["auth", "list-users", query],
      });
    },
  },
  createUser: {
    mutation: () => {
      return useMutation({
        mutationFn: (
          body: z.infer<typeof authService.createUserRequestBodySchema>
        ) => authService.createUser(body),
        onSuccess(_, __, ___, ctx) {
          ctx.client.invalidateQueries({
            queryKey: ["auth", "list-users"],
          });
        },
      });
    },
  },
  updateUserPartial: {
    mutation: () => {
      return useMutation({
        mutationFn: (data: { userId: string; isSystemAdmin: boolean }) =>
          authService.updateUserPartial(data.userId, {
            isSystemAdmin: data.isSystemAdmin,
          }),
        onSuccess: (_, __, ___, ctx) => {
          ctx.client.invalidateQueries({
            queryKey: ["auth", "list-users"],
          });
        },
      });
    },
  },
  deleteUser: {
    mutation: () => {
      return useMutation({
        mutationFn: (userId: string) => authService.deleteUser(userId),
        onSuccess: (_, __, ___, ctx) => {
          ctx.client.invalidateQueries({
            queryKey: ["auth", "list-users"],
          });
        },
      });
    },
  },
};
