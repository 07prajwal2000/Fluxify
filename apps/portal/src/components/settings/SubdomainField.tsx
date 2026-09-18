import { Input, Label, TextField } from "@fluxify/components";
import { DEFAULT_BASE_DOMAIN, subdomainSchema } from "@fluxify/server/src/lib/hosting";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";

export function useBaseDomain() {
	const { data } = publicSettingsQuery.get.useQuery();
	return data?.hosting?.baseDomain || DEFAULT_BASE_DOMAIN;
}

/**
 * Where the playground sends a project's requests. A project with a subdomain
 * is not served on the portal's own host, so the host is swapped and the
 * scheme and port kept — the same edge serves both.
 */
export function useProjectApiBaseUrl(projectId: string) {
	const baseDomain = useBaseDomain();
	const { data } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const subdomain = ((data ?? {}) as Record<string, string>)["settings.routing.subdomain"];
	const base = import.meta.env.VITE_ROUTE_BASE_URL ?? window.location.origin;
	if (!subdomain) return base;
	const url = new URL(base);
	url.hostname = `${subdomain}.${baseDomain}`;
	return url.origin;
}

/** The server's own rule, so the form rejects exactly what the API would. Empty is allowed. */
export function subdomainError(value: string): string | null {
	if (!value) return null;
	const result = subdomainSchema.safeParse(value);
	return result.success ? null : (result.error.issues[0]?.message ?? "Invalid subdomain");
}

export function SubdomainField({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	const baseDomain = useBaseDomain();
	const error = subdomainError(value);

	return (
		<TextField value={value} onChange={(next) => onChange(next.trim().toLowerCase())} isInvalid={!!error}>
			<Label>Subdomain</Label>
			<Input placeholder="billing" maxLength={63} />
			{error ? (
				<p className="text-xs text-danger">{error}</p>
			) : (
				<p className="text-xs text-muted">
					{value ? (
						<>
							APIs are served on <code>{value}.{baseDomain}</code> only.
						</>
					) : (
						<>
							Optional. Leave empty to share <code>{baseDomain}</code> with other projects, where two
							projects using the same path clash.
						</>
					)}
				</p>
			)}
		</TextField>
	);
}
