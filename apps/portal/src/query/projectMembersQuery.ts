import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectMembersService } from "@/services/projectMembers";

type Role = "viewer" | "creator" | "project_admin";
const key = (projectId: string) => ["project-members", projectId];

export const projectMembersQuery = {
	list: {
		useQuery(projectId: string, query: { page?: number; perPage?: number }) {
			return useQuery({
				queryKey: [...key(projectId), query],
				queryFn: () => projectMembersService.list(projectId, query),
				refetchOnWindowFocus: false,
			});
		},
	},
	update: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (data: { userId: string; role: Role }) =>
					projectMembersService.update(projectId, data.userId, { role: data.role }),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
	remove: {
		mutation(projectId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (userId: string) => projectMembersService.remove(projectId, userId),
				onSuccess: () => qc.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
};
