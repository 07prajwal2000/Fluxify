import { ADMIN_API_URL } from "../lib/env";

/** Sends one request to the admin API. Swapped in tests to stay in-process. */
export type AdminFetch = (path: string, init: RequestInit) => Response | Promise<Response>;

export const httpAdminFetch: AdminFetch = (path, init) => fetch(`${ADMIN_API_URL}${path}`, init);

/** The project role a tool needs, named in its 403 message. */
export type ToolRole = "viewer" | "creator" | "project_admin";

const ROLE_NAMES: Record<ToolRole, string> = {
	viewer: "Viewer",
	creator: "Creator",
	project_admin: "Project Admin",
};

export type Query = Record<string, string | number | undefined>;

/** GETs an admin API path as the caller; throws a readable error on failure. */
export type AdminGet = (path: string, query?: Query) => Promise<any>;

/**
 * Turns an admin API failure into a sentence an agent can act on. The server's
 * own message is kept where it says something the status does not.
 */
export function readableError(status: number, body: unknown, role: ToolRole): string {
	const b = (body ?? {}) as { message?: unknown; errors?: { field: string; message: string }[] };
	const message = typeof b.message === "string" ? b.message : "";
	switch (status) {
		case 400:
			if (Array.isArray(b.errors) && b.errors.length) {
				return `Invalid input: ${b.errors.map((e) => `${e.field}: ${e.message}`).join("; ")}`;
			}
			return `Invalid input${message ? `: ${message}` : "."}`;
		case 401:
			return "Your Fluxify sign-in expired or was revoked. Reconnect the MCP server and sign in again.";
		case 403:
			return `You need the ${ROLE_NAMES[role]} role in this project.`;
		case 404:
			return `Not found${message ? `: ${message}` : "."} Check the id with a list_* tool.`;
		case 429:
			return message || "Too many requests. Wait a second and retry.";
		default:
			return `Fluxify API error ${status}${message ? `: ${message}` : "."}`;
	}
}

/**
 * A GET helper bound to one caller. `auth` is the caller's own Authorization
 * (or cookie) header, so the server applies the same roles it applies to the
 * portal: tools never check roles themselves.
 */
export function adminGet(
	fetcher: AdminFetch,
	auth: Record<string, string>,
	role: ToolRole,
): AdminGet {
	return async (path, query = {}) => {
		const params = new URLSearchParams();
		for (const [k, v] of Object.entries(query)) if (v !== undefined) params.set(k, String(v));
		const qs = params.size ? `?${params}` : "";
		const res = await fetcher(`/_/admin/api${path}${qs}`, {
			headers: { ...auth, accept: "application/json" },
		});
		const body = await res.json().catch(() => null);
		if (!res.ok) throw new Error(readableError(res.status, body, role));
		return body;
	};
}
