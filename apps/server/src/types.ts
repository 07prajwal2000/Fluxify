import type { Context, Hono } from "hono";
import type { AccessControlRole } from "./db/schema";
import type { auth } from "./lib/auth";

export type HonoVariables = {
	user: typeof auth.$Infer.Session.user | null;
	session: typeof auth.$Infer.Session.session | null;
	acl: { projectId: string; role: AccessControlRole }[] | null;
	projectId?: string;
	routeId?: string;
	testSuite?: any;
};

export type HonoServer = Hono<{
	Variables: HonoVariables;
}>;

export type HonoContext = Context<{ Variables: HonoVariables }>;
