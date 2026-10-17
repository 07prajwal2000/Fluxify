// Shared by the MCP OAuth tests (#824): a real admin server (Postgres, Redis, NATS in
// containers) and a math MCP server in OAuth mode, driven the way the portal does.
import { expect } from "bun:test";
import type { startMathMcp } from "@fluxify/mcp-math";
import {
	type AuthServer,
	createProject,
	createUser,
	req,
	signIn,
	startAuthServer,
} from "../mcp/tests/authHarness";

export type Math = Awaited<ReturnType<typeof startMathMcp>>;
export type Env = "development" | "production";

export const api = (projectId: string) => `/_/admin/api/v1/${projectId}/integrations`;

export type Stack = Awaited<ReturnType<typeof startStack>>;

/** One project with an admin, a second admin and a creator; one other project with its own admin. */
export async function startStack() {
	const s = await startAuthServer();
	const projectId = await createProject(s);
	const otherProjectId = await createProject(s);
	const cookie = async (role: "creator" | "project_admin", project = projectId) =>
		signIn(s, (await createUser(s, role, project)).email);
	return {
		s,
		projectId,
		otherProjectId,
		admin: await cookie("project_admin"),
		admin2: await cookie("project_admin"),
		creator: await cookie("creator"),
		otherAdmin: await cookie("project_admin", otherProjectId),
	};
}

/** Saves an mcp integration that signs in with OAuth. */
export async function createOAuthIntegration(
	stack: Stack,
	math: Math,
	extra: { syncDev?: boolean; devConfig?: object | null } = {},
) {
	const res = await req(stack.s, api(stack.projectId), {
		cookie: stack.admin,
		json: {
			name: `oauth-${crypto.randomUUID().slice(0, 8)}`,
			group: "mcp",
			variant: "http",
			config: { url: math.url, auth: "oauth", headers: [] },
			...extra,
		},
	});
	expect(res.status).toBe(201);
	return ((await res.json()) as { id: string }).id;
}

/** Connect, then sign in at the authorization server: the address it sends the browser back to. */
export async function startConnect(
	stack: Stack,
	id: string,
	env: Env,
	cookie = stack.admin,
	projectId = stack.projectId,
) {
	const res = await req(stack.s, `${api(projectId)}/${id}/mcp-oauth/connect`, {
		cookie,
		json: { env },
	});
	expect(res.status).toBe(200);
	const { authorizationUrl } = (await res.json()) as { authorizationUrl: string };
	const back = await fetch(authorizationUrl, { redirect: "manual" });
	const callback = new URL(back.headers.get("location")!);
	return callback.pathname + callback.search;
}

/** The whole flow: Connect, sign in, the browser comes back. */
export async function connectEnv(stack: Stack, id: string, env: Env) {
	const callback = await startConnect(stack, id, env);
	const res = await req(stack.s, callback, { cookie: stack.admin });
	expect(res.status).toBe(302);
	expect(res.headers.get("location")).toContain("mcpOAuth=connected");
}

export async function waitFor<T>(read: () => T | undefined | Promise<T | undefined>, ms = 10_000) {
	for (const deadline = Date.now() + ms; Date.now() < deadline; await Bun.sleep(50)) {
		const value = await read();
		if (value) return value;
	}
	throw new Error("timed out waiting");
}

/** The stored row, as the database holds it (tokens still encrypted). */
export async function storedRow(stack: Stack, id: string) {
	const { integrationsEntity } = await import("@fluxify/server/src/db/schema");
	const { eq } = await import("drizzle-orm");
	const [row] = await stack.s.db
		.select()
		.from(integrationsEntity)
		.where(eq(integrationsEntity.id, id));
	return row as { config: any; devConfig: any; syncDev: boolean; id: string; projectId: string };
}

/** The tokens in the row, decrypted, so a test knows what must never show up in a response. */
export async function storedTokens(
	stack: Stack,
	id: string,
	column: "config" | "devConfig" = "config",
) {
	const { EncryptionService } = await import("@fluxify/server/src/lib/encryption");
	const oauth = (await storedRow(stack, id))[column]?.oauth;
	return {
		version: oauth?.v as number | undefined,
		tokens: oauth?.tokens
			? (JSON.parse(EncryptionService.decrypt(oauth.tokens)) as {
					access_token: string;
					refresh_token: string;
				})
			: undefined,
	};
}

export type { AuthServer };
