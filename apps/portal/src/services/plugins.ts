import type {
	fsCandidatesSchema,
	installStatusSchema,
	listResponseSchema,
	pluginSchema,
	upgradePreviewSchema,
	urlRequestSchema,
	usageSchema,
} from "@fluxify/server/src/api/v1/plugins/dto";
import type { PluginLiveVersion } from "@fluxify/server/src/db/schema";
import type z from "zod";
import { httpClient } from "@/lib/http";

export type Plugin = z.infer<typeof pluginSchema>;
export type PluginInstallStatus = z.infer<typeof installStatusSchema>;
export type PluginUsage = z.infer<typeof usageSchema>;
export type PluginUpgradePreview = z.infer<typeof upgradePreviewSchema>;
export type PluginUpgradeDiff = PluginUpgradePreview["diff"];
export type PluginUrlRequest = z.infer<typeof urlRequestSchema>;
export type PluginFsCandidate = z.infer<typeof fsCandidatesSchema>[number];
/** `fluxify.json`: the plugin's blocks with their shape, invoke modes, params, handles and permissions */
export type PluginManifest = PluginLiveVersion["manifest"];
export type PluginEnvironments = { dev: boolean; prod: boolean };

const base = "/v1/plugins";
const scoped = (projectId: string) => ({ params: { projectId } });

/** Everything the portal asks of a project's plugins. `name` is `scope/name`, sent as two path segments. */
export const pluginsService = {
	async list(projectId: string): Promise<z.infer<typeof listResponseSchema>> {
		return (await httpClient.get(`${base}/list`, scoped(projectId))).data;
	},
	async installStatus(projectId: string, name: string): Promise<PluginInstallStatus> {
		return (await httpClient.get(`${base}/${name}/install-status`, scoped(projectId))).data;
	},
	async usage(projectId: string, name: string): Promise<PluginUsage> {
		return (await httpClient.get(`${base}/${name}/usage`, scoped(projectId))).data;
	},
	async upgradePreview(projectId: string, name: string): Promise<PluginUpgradePreview> {
		return (await httpClient.get(`${base}/${name}/upgrade-preview`, scoped(projectId))).data;
	},
	async setEnvironments(
		projectId: string,
		name: string,
		envs: PluginEnvironments,
	): Promise<Plugin> {
		return (await httpClient.put(`${base}/${name}/environments`, envs, scoped(projectId))).data;
	},
	/** `integrity` is what the creator reviewed: a plugin that changed since is refused with a 409 */
	async approve(projectId: string, name: string, integrity: string): Promise<Plugin> {
		return (await httpClient.post(`${base}/${name}/approve`, { integrity }, scoped(projectId)))
			.data;
	},
	/** rejects a new plugin; on a pending upgrade it only cancels the upgrade */
	async reject(projectId: string, name: string): Promise<Plugin> {
		return (await httpClient.post(`${base}/${name}/reject`, undefined, scoped(projectId))).data;
	},
	async remove(projectId: string, name: string): Promise<{ name: string }> {
		return (await httpClient.delete(`${base}/${name}`, scoped(projectId))).data;
	},
	async scan(projectId: string, name: string): Promise<Plugin> {
		return (await httpClient.post(`${base}/${name}/scan`, undefined, scoped(projectId))).data;
	},
	async scanProject(projectId: string): Promise<Plugin[]> {
		return (await httpClient.post(`${base}/scan`, undefined, scoped(projectId))).data;
	},
	async upload(projectId: string, file: File): Promise<Plugin> {
		const form = new FormData();
		form.append("file", file);
		return (
			await httpClient.post(`${base}/upload`, form, {
				...scoped(projectId),
				headers: { "Content-Type": "multipart/form-data" },
			})
		).data;
	},
	/** `name@x.y.z`: an exact version */
	async addNpm(projectId: string, spec: string): Promise<Plugin> {
		return (await httpClient.post(`${base}/npm`, { spec }, scoped(projectId))).data;
	},
	/** step 1: records the URL; nothing is downloaded until `fetchUrl` */
	async requestUrl(projectId: string, url: string): Promise<PluginUrlRequest> {
		return (await httpClient.post(`${base}/url`, { url }, scoped(projectId))).data;
	},
	async urlRequests(projectId: string): Promise<PluginUrlRequest[]> {
		return (await httpClient.get(`${base}/url/list`, scoped(projectId))).data;
	},
	/** step 2: lets the server download, validate and store the URL */
	async fetchUrl(projectId: string, requestId: string): Promise<Plugin> {
		return (await httpClient.post(`${base}/url/${requestId}/fetch`, undefined, scoped(projectId)))
			.data;
	},
	async discoverFs(projectId: string): Promise<PluginFsCandidate[]> {
		return (await httpClient.get(`${base}/fs/discover`, scoped(projectId))).data;
	},
	async addFs(projectId: string, path: string): Promise<Plugin> {
		return (await httpClient.post(`${base}/fs`, { path }, scoped(projectId))).data;
	},
};

/**
 * The 409 of an approval that would take away something the project uses
 * carries the same diff as the upgrade preview, so the dialog can show it
 * instead of a bare toast.
 */
export function upgradeBlockedFromError(
	error: unknown,
): { message: string; diff: PluginUpgradeDiff } | undefined {
	const data = (error as { response?: { data?: unknown } } | undefined)?.response?.data as
		| { message?: unknown; diff?: PluginUpgradeDiff }
		| undefined;
	if (!data?.diff || !Array.isArray(data.diff.blockers)) return undefined;
	return {
		message: typeof data.message === "string" ? data.message : "This upgrade is blocked",
		diff: data.diff,
	};
}
