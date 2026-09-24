import { useNpmPackageTypes } from "@fluxify/components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectPackagesService } from "@/services/projectPackages";

const key = (projectId: string) => ["project-packages", projectId];

export const projectPackagesQuery = {
	list: {
		useQuery(projectId: string) {
			return useQuery({
				queryKey: key(projectId),
				queryFn: () => projectPackagesService.list(projectId),
				refetchOnWindowFocus: false,
			});
		},
	},
	status: {
		/** polls until every worker settled on the current version */
		useQuery(projectId: string) {
			return useQuery({
				queryKey: [...key(projectId), "status"],
				queryFn: () => projectPackagesService.status(projectId),
				refetchInterval: (q) => (q.state.data?.done === false ? 2000 : false),
			});
		},
	},
	updates: {
		useQuery(projectId: string, enabled: boolean) {
			return useQuery({
				queryKey: [...key(projectId), "updates"],
				queryFn: () => projectPackagesService.updates(projectId),
				enabled,
				refetchOnWindowFocus: false,
			});
		},
	},
	install: {
		useMutation(projectId: string) {
			const client = useQueryClient();
			return useMutation({
				mutationFn: (body: Parameters<typeof projectPackagesService.install>[1]) =>
					projectPackagesService.install(projectId, body),
				// the response is the new list; the status query then polls the rollout
				onSuccess: (list) => {
					client.setQueryData(key(projectId), list);
					return client.invalidateQueries({ queryKey: [...key(projectId), "status"] });
				},
			});
		},
	},
	remove: {
		useMutation(projectId: string) {
			const client = useQueryClient();
			return useMutation({
				mutationFn: (names: string[]) => projectPackagesService.remove(projectId, { names }),
				// the response is the new list; the status query then polls the rollout
				onSuccess: (list) => {
					client.setQueryData(key(projectId), list);
					return client.invalidateQueries({ queryKey: [...key(projectId), "status"] });
				},
			});
		},
	},
};

/** editor autocomplete for the project's installed packages */
export function useProjectPackageTypes(projectId: string) {
	const { data } = projectPackagesQuery.list.useQuery(projectId);
	useNpmPackageTypes(data?.packages);
}
