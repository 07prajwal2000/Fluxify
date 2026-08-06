import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { projectSettingsKeysService } from "@/services/projectSettingsKeys";

const key = (projectId: string) => ["project-settings-keys", projectId];

export const projectSettingsKeysQuery = {
	getAll: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: key(projectId),
				queryFn: () => projectSettingsKeysService.getAll(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	upsert: {
		useMutation(projectId: string) {
			const client = useQueryClient();
			return useMutation({
				mutationFn: (body: RequestBodySchema) =>
					projectSettingsKeysService.upsert(projectId, body),
				onSuccess: () =>
					client.invalidateQueries({ queryKey: key(projectId) }),
			});
		},
	},
};
