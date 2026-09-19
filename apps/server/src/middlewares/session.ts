import type { Context, Next } from "hono";
import { auth } from "../lib/auth";

export async function setSession(c: Context, next: Next) {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });
	if (!session) {
		c.set("user", null);
		c.set("session", null);
		c.set("acl", null);
		await next();
		return;
	}
	c.set("user", session.user);
	c.set("session", session.session);
	c.set("acl", session.acl);
	await next();
}
