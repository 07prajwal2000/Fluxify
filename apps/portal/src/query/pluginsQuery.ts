import { type QueryKey, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PluginEnvironments, pluginsService } from "@/services/plugins";

export const pluginsKey = (projectId: string): QueryKey => ["plugins", projectId];

/** a write to the registry: whatever it returns, every plugin query of the project is stale */
function useRegistryMutation<V, R>(projectId: string, fn: (v: V) => Promise<R>) {
	const client = useQueryClient();
	return useMutation({
		mutationFn: fn,
		onSuccess: () => client.invalidateQueries({ queryKey: pluginsKey(projectId) }),
	});
}

export const pluginsQuery = {
	list: {
		useQuery: (projectId: string) =>
			useQuery({
				queryKey: [...pluginsKey(projectId), "list"],
				queryFn: () => pluginsService.list(projectId),
				refetchOnWindowFocus: false,
			}),
	},
	/** polls until every worker settled on the plugin's version */
	installStatus: {
		useQuery: (projectId: string, name: string) =>
			useQuery({
				queryKey: [...pluginsKey(projectId), name, "install-status"],
				queryFn: () => pluginsService.installStatus(projectId, name),
				refetchInterval: (q) =>
					q.state.data && !q.state.data.done && !q.state.data.failed ? 2000 : false,
			}),
	},
	usage: {
		useQuery: (projectId: string, name: string) =>
			useQuery({
				queryKey: [...pluginsKey(projectId), name, "usage"],
				queryFn: () => pluginsService.usage(projectId, name),
			}),
	},
	upgradePreview: {
		useQuery: (projectId: string, name: string, enabled: boolean) =>
			useQuery({
				queryKey: [...pluginsKey(projectId), name, "upgrade-preview"],
				queryFn: () => pluginsService.upgradePreview(projectId, name),
				enabled,
			}),
	},
	urlRequests: {
		useQuery: (projectId: string, enabled: boolean) =>
			useQuery({
				queryKey: [...pluginsKey(projectId), "url-requests"],
				queryFn: () => pluginsService.urlRequests(projectId),
				enabled,
			}),
	},
	fsCandidates: {
		useQuery: (projectId: string, enabled: boolean) =>
			useQuery({
				queryKey: [...pluginsKey(projectId), "fs-discover"],
				queryFn: () => pluginsService.discoverFs(projectId),
				enabled,
				refetchOnWindowFocus: false,
			}),
	},
	setEnvironments: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (v: { name: string; envs: PluginEnvironments }) =>
				pluginsService.setEnvironments(projectId, v.name, v.envs),
			),
	},
	approve: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (v: { name: string; integrity: string }) =>
				pluginsService.approve(projectId, v.name, v.integrity),
			),
	},
	reject: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (name: string) => pluginsService.reject(projectId, name)),
	},
	remove: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (name: string) => pluginsService.remove(projectId, name)),
	},
	scan: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (name: string) => pluginsService.scan(projectId, name)),
	},
	scanProject: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, () => pluginsService.scanProject(projectId)),
	},
	upload: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (file: File) => pluginsService.upload(projectId, file)),
	},
	addNpm: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (spec: string) => pluginsService.addNpm(projectId, spec)),
	},
	requestUrl: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (url: string) => pluginsService.requestUrl(projectId, url)),
	},
	fetchUrl: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (id: string) => pluginsService.fetchUrl(projectId, id)),
	},
	addFs: {
		useMutation: (projectId: string) =>
			useRegistryMutation(projectId, (path: string) => pluginsService.addFs(projectId, path)),
	},
};
