import z from "zod";

/**
 * Host naming for per-project subdomains (#340). Pure on purpose: the isolated
 * execution process imports it, and that process must not reach NATS or the
 * database.
 */

/** Served when no base domain has been configured. */
export const DEFAULT_BASE_DOMAIN = "localhost";

/** Names that already mean something on a host, so no project may take them. */
export const RESERVED_SUBDOMAINS = ["www", "admin", "api"];

/** One DNS label, lowercase — what a project's subdomain is. */
export const subdomainSchema = z
	.string()
	.regex(
		/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/,
		"Use 1-63 lowercase letters, digits or hyphens, not starting or ending with a hyphen",
	)
	.refine((value) => !RESERVED_SUBDOMAINS.includes(value), "This subdomain is reserved");

export const hostnameSchema = z
	.string()
	.max(253)
	.regex(
		/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/,
		"Use a lowercase hostname such as example.com",
	);

export function projectHost(subdomain: string, baseDomain: string) {
	return `${subdomain}.${baseDomain}`;
}

/**
 * The subdomain a request's `Host` names, or null when it is not a subdomain of
 * the base domain at all — the bare domain, an IP, any other name pointed at
 * the server. Those are served from the shared routes.
 */
export function subdomainOf(host: string | undefined, baseDomain: string): string | null {
	if (!host) return null;
	const name = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
	const suffix = `.${baseDomain}`;
	return name.endsWith(suffix) ? name.slice(0, -suffix.length) : null;
}

/** Hosts the portal is trusted on while no base domain is configured. */
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/**
 * Whether a browser `Origin` is the portal, which may call any project's
 * subdomain from its playground. The portal is served on the base domain, so
 * that is the anchor, and it follows the instance when the domain changes.
 * `TRUSTED_ORIGINS` is honoured too, for a portal served somewhere else.
 * Nothing configured means a local install.
 */
export function isPortalOrigin(
	origin: string | null | undefined,
	configuredBaseDomain: string,
	trustedOrigins: readonly string[] = [],
) {
	if (!origin) return false;
	if (trustedOrigins.includes(origin)) return true;
	let hostname: string;
	try {
		hostname = new URL(origin).hostname;
	} catch {
		return false;
	}
	return configuredBaseDomain ? hostname === configuredBaseDomain : LOCAL_HOSTS.includes(hostname);
}
