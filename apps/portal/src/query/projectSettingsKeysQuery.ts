import { useQuery } from "@tanstack/react-query";
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
};
