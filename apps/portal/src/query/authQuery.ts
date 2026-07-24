import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { authService } from "@/services/auth";

const LIST_KEY = ["auth", "list-users"];

export const authQuery = {
	listUsers: {
		useQuery(query: z.infer<typeof authService.listUsersRequestBodySchema>) {
			return useQuery({
				queryKey: [...LIST_KEY, query],
				queryFn: () => authService.listUsers(query),
				refetchOnWindowFocus: false,
			});
		},
	},
	createUser: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (
					body: z.infer<typeof authService.createUserRequestBodySchema>,
				) => authService.createUser(body),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	updateUserPartial: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { userId: string; isSystemAdmin: boolean }) =>
					authService.updateUserPartial(data.userId, {
						isSystemAdmin: data.isSystemAdmin,
					}),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
	deleteUser: {
		mutation() {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (userId: string) => authService.deleteUser(userId),
				onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
			});
		},
	},
};
