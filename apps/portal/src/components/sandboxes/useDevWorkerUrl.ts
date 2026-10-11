import { useQuery } from "@tanstack/react-query";
import { useProjectApiBaseUrl } from "@/components/settings/SubdomainField";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import { projectDevTokenService } from "@/services/projectDevToken";

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

/**
 * The project's development token. It shares its cache with the Development
 * access settings, and is only ever sent in a header, never shown.
 */
export function useDevToken(projectId: string) {
	return useQuery({
		queryKey: ["project-dev-token", projectId],
		queryFn: () => projectDevTokenService.get(projectId),
		refetchOnWindowFocus: false,
	});
}
