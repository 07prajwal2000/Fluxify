import type { Context, Next } from "hono";
import { auth } from "../lib/auth";
import { resolveBearerSession } from "../lib/bearerAuth";
import { runWithAuditContext } from "../modules/audit/context";
import type { AuditSource } from "../modules/audit/types";

// Cookie login first; without one, an OAuth access token or personal access
// token in `Authorization: Bearer`. Both end in the same user + ACL.
export async function setSession(c: Context, next: Next) {
	const headers = c.req.raw.headers;
	const session = (await auth.api.getSession({ headers })) ?? (await resolveBearerSession(headers));
	c.set("user", session?.user ?? null);
	c.set("session", session?.session ?? null);
	c.set("acl", session?.acl ?? null);
	// who is asking, for `audit.record` anywhere below
	const user = session?.user;
	await runWithAuditContext(
		{
			actor: user ? { actorId: user.id, actorEmail: user.email } : null,
			source: (session as { source?: AuditSource } | null)?.source ?? "portal",
		},
		next,
	);
}
