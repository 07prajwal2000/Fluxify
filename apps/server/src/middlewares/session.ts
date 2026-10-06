import type { Context, Next } from "hono";
import { auth } from "../lib/auth";
import { resolveBearerSession } from "../lib/bearerAuth";

// Cookie login first; without one, an OAuth access token or personal access
// token in `Authorization: Bearer`. Both end in the same user + ACL.
export async function setSession(c: Context, next: Next) {
	const headers = c.req.raw.headers;
	const session = (await auth.api.getSession({ headers })) ?? (await resolveBearerSession(headers));
	c.set("user", session?.user ?? null);
	c.set("session", session?.session ?? null);
	c.set("acl", session?.acl ?? null);
	await next();
}
