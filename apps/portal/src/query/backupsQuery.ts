import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { backupsService, type StartBackupBody } from "@/services/backups";

const key = (projectId: string) => ["backups", projectId];
const POLL_MS = 2000;

export const backupsQuery = {
	sections: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: [...key(projectId), "sections"],
				queryFn: () => backupsService.sections(projectId),
				refetchOnWindowFocus: false,
				staleTime: Number.POSITIVE_INFINITY,
			});
		},
	},
	list: {
		/** polls while a backup is running, so the table follows it to the end */
		useQuery(projectId: string) {
			return useQuery({
				queryKey: key(projectId),
				queryFn: () => backupsService.list(projectId),
				refetchOnWindowFocus: false,
				refetchInterval: (query) =>
					query.state.data?.backups.some((b) => b.status === "running") ? POLL_MS : false,
			});
		},
	},
	start: {
		useMutation(projectId: string) {
			const client = useQueryClient();
			return useMutation({
				mutationFn: (body: StartBackupBody) => backupsService.start(projectId, body),
				onSuccess: () => {
					client.invalidateQueries({ queryKey: key(projectId) });
					// the README that was sent is remembered with the project's settings
					client.invalidateQueries({ queryKey: ["project-settings-keys", projectId] });
				},
			});
		},
	},
};
