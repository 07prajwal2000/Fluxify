import { useQuery } from "@tanstack/react-query";
import { useProjectApiBaseUrl } from "@/components/settings/SubdomainField";
import { projectDevTokenService } from "@/services/projectDevToken";

/**
 * Where a browser sends a development call: the project's own API address,
 * subdomain included. The proxy in front already sends `/_sandbox` and
 * `/_/dev` to a development worker, and it picks the right pool by `Host`,
 * which only the project's own address carries. `PROXY_URL` is the admin's
 * internal route to that proxy, never one the browser can open.
 */
export function useDevWorkerUrl(projectId: string) {
	return useProjectApiBaseUrl(projectId).replace(/\/+$/, "");
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
