// A real admin server (Postgres + Redis in containers) with the MCP endpoint
// mounted, for the OAuth / access-token tests. Env must be set before any
// server module loads (getEnv caches on first read), so everything server-side
// is imported dynamically in `startAuthServer`.
import { createHash, randomBytes } from "node:crypto";
import { join } from "node:path";
import { docker, pullImage, startContainerWithRandomPort } from "@fluxify/adapters/containerTestHelpers";
import type Docker from "dockerode";
import { Hono } from "hono";

export const ORIGIN = "http://localhost:8080";
export const MCP_RESOURCE = `${ORIGIN}/_/admin/mcp`;
export const REDIRECT_URI = "http://127.0.0.1:33418/callback";
export const PASSWORD = "Passw0rd!test";

const containers: Docker.Container[] = [];

async function start(image: string, name: string, port: string, env: string[] = []) {
	await docker.getContainer(name).remove({ force: true }).catch(() => {});
	await pullImage(image);
	const started = await startContainerWithRandomPort((hostPort) =>
		docker.createContainer({
			Image: image,
			name,
			Env: env,
			HostConfig: { PortBindings: { [port]: [{ HostPort: String(hostPort) }] } },
		}),
	);
	containers.push(started.container);
	return started.port;
}

async function retry<T>(fn: () => Promise<T>, attempts = 60): Promise<T> {
	for (let i = 1; ; i++) {
		try {
			return await fn();
		} catch (error) {
			if (i >= attempts) throw error;
			await Bun.sleep(500);
		}
	}
}

export async function stopAuthServer() {
	await Promise.all(containers.map((c) => c.remove({ force: true }).catch(() => {})));
}

export async function startAuthServer() {
	const [pgPort, redisPort] = await Promise.all([
		start("postgres:bullseye", "fluxify-mcp-auth-pg", "5432/tcp", ["POSTGRES_PASSWORD=postgres"]),
		start("valkey/valkey:8-alpine", "fluxify-mcp-auth-redis", "6379/tcp"),
	]);
	Object.assign(process.env, {
		NODE_ENV: "test",
		PG_URL: `postgres://postgres:postgres@127.0.0.1:${pgPort}/postgres`,
		REDIS_HOST: "127.0.0.1",
		REDIS_PORT: String(redisPort),
		SERVER_URL: ORIGIN,
		BETTER_AUTH_URL: ORIGIN,
		TRUSTED_ORIGINS: ORIGIN,
		BETTER_AUTH_SECRET: "test-secret-for-mcp-auth-integration",
		ADMIN_RATE_LIMIT_PER_SEC: "0",
	});

	const server = await import("@fluxify/server");
	const { drizzleInit } = await import("@fluxify/server/src/db");
	const { migrate } = await import("drizzle-orm/bun-sql/migrator");
	const db = await retry(() => drizzleInit(false));
	await migrate(db, {
		migrationsFolder: join(import.meta.dir, "../../../../server/src/db/migrations"),
	});
	server.initializeRedis();
	await retry(() => server.pingRedis());
	server.initializeAuth(db);

	const { default: authRouter } = await import("@fluxify/server/src/api/auth/register");
	const { mapVersionedAdminRoutes } = await import("@fluxify/server/src/api/register");
	const { mapMcpServer } = await import("../index");
	const app = new Hono<any>();
	app.onError(server.errorHandler);
	app.use("*", server.setSession);
	authRouter.registerHandler(app);
	mapVersionedAdminRoutes(app);
	mapMcpServer(app);
	return { app, db, server };
}

export type AuthServer = Awaited<ReturnType<typeof startAuthServer>>;

/** A pre-provisioned user, like an admin would create, with a role in `projectId`. */
export async function createUser(s: AuthServer, role: "viewer" | "creator", projectId: string) {
	const email = `${crypto.randomUUID()}@test.local`;
	const { createSystemUser } = await import("@fluxify/server/src/lib/system-users");
	const su = await createSystemUser({ email, name: "Test" });
	await s.server.auth.api.createUser({ body: { email, name: "Test", password: PASSWORD } });
	await s.db
		.insert(s.server.accessControlEntity)
		.values({ userId: su.id, projectId, role });
	return { id: su.id, email };
}

export async function createProject(s: AuthServer) {
	const [p] = await s.db
		.insert(s.server.projectsEntity)
		.values({ name: "MCP auth", slug: `mcp-${crypto.randomUUID().slice(0, 8)}` })
		.returning();
	return p.id;
}

export function pkce() {
	const verifier = randomBytes(32).toString("base64url");
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export async function req(
	s: AuthServer,
	path: string,
	init: {
		method?: string;
		cookie?: string;
		bearer?: string;
		ip?: string;
		json?: unknown;
		form?: Record<string, string>;
	} = {},
) {
	// A fresh client address per request, so the per-IP OAuth limits never trip.
	const headers: Record<string, string> = { origin: ORIGIN, "x-forwarded-for": init.ip ?? crypto.randomUUID() };
	if (init.cookie) headers.cookie = init.cookie;
	if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
	let body: string | undefined;
	if (init.json !== undefined) {
		headers["content-type"] = "application/json";
		body = JSON.stringify(init.json);
	} else if (init.form) {
		headers["content-type"] = "application/x-www-form-urlencoded";
		body = new URLSearchParams(init.form).toString();
	}
	return s.app.request(`${ORIGIN}${path}`, { method: init.method ?? (body ? "POST" : "GET"), headers, body });
}

export async function signIn(s: AuthServer, email: string) {
	const res = await req(s, "/_/admin/api/auth/sign-in/email", { json: { email, password: PASSWORD } });
	if (res.status !== 200) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
	return res.headers
		.getSetCookie()
		.map((c) => c.split(";")[0])
		.join("; ");
}
