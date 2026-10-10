import { useProjectApiBaseUrl } from "@/components/settings/SubdomainField";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";

/**
 * Where sandbox calls go: the operator's `DEV_WORKER_URL` when one is set, and
 * otherwise the project's own API address, which the proxy in front of a
 * deployment already sends `/_sandbox` to the development worker from.
 */
export function useDevWorkerUrl(projectId: string) {
	const { data } = publicSettingsQuery.get.useQuery();
	const apiBase = useProjectApiBaseUrl(projectId);
	return (data?.devWorkerUrl || apiBase).replace(/\/+$/, "");
}
