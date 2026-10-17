// An Enterprise admin server for the audit log tests (#833), run as its own
// process by `audit.ts` for the same reason as `mcpStack.ts`: the server caches
// its env on first import. Unlike the MCP stack it
//   - runs the audit consumer, as boot does, so events reach Postgres;
//   - publishes the licence (the default, non-commercial, entitles audit logs);
//   - serves over real HTTP, with the MCP endpoint calling the admin API through
//     the real `httpAdminFetch`, so the `x-fluxify-via` label is the production one.
// Prints one `AUDIT_STACK <json>` line once it serves, and shuts down when its
// stdin closes.
import {
	createProject,
	MCP_RESOURCE,
	ORIGIN,
	PASSWORD,
	pkce,
	REDIRECT_URI,
	req,
	signIn,
	startAuthServer,
	stopAuthServer,
} from "@fluxify/ai-gateway/src/mcp/tests/authHarness";

const AUTH = "/_/admin/api/auth";

/** A port nothing listens on yet. */
function freePort() {
	const probe = Bun.serve({ port: 0, fetch: () => new Response() });
	const { port } = probe;
	probe.stop(true);
	return port;
}

const port = freePort();
// SERVER_PORT is where the MCP server finds the admin API (`ADMIN_API_URL`)
const s = await startAuthServer({ SERVER_PORT: String(port) });

// as boot does: the licence reaches every process through the config store
const { publishConfiguredLicense } = await import(
	"@fluxify/server/src/api/v1/instance-settings/license/service"
);
await publishConfiguredLicense();
const { startAuditConsumer } = await import("@fluxify/server/src/modules/audit/consumer");
await startAuditConsumer();

const { createSystemUser } = await import("@fluxify/server/src/lib/system-users");
const email = `${crypto.randomUUID()}@test.local`;
const admin = await createSystemUser({ email, name: "Audit Admin", isSystemAdmin: true });
await s.server.auth.api.createUser({ body: { email, name: "Audit Admin", password: PASSWORD } });
const cookie = await signIn(s, email);

const keyRes = await req(s, `${AUTH}/api-key/create`, { cookie, json: { name: "audit-e2e" } });
if (!keyRes.ok) throw new Error(`api key: ${keyRes.status} ${await keyRes.text()}`);
const pat = ((await keyRes.json()) as { key: string }).key;

/** An MCP client's OAuth access token: register, authorize with PKCE, consent, exchange. */
async function oauthToken() {
	const reg = await req(s, `${AUTH}/oauth2/register`, {
		json: {
			client_name: "Audit e2e client",
			redirect_uris: [REDIRECT_URI],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
	});
	const clientId = ((await reg.json()) as { client_id: string }).client_id;
	const { verifier, challenge } = pkce();
	const query = new URLSearchParams({
		response_type: "code",
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		scope: "openid profile email offline_access",
		state: "st4te",
		code_challenge: challenge,
		code_challenge_method: "S256",
		resource: MCP_RESOURCE,
	});
	const authorize = await req(s, `${AUTH}/oauth2/authorize?${query}`, { cookie });
	const consentUrl = new URL(authorize.headers.get("location")!, ORIGIN);
	const consent = await req(s, `${AUTH}/oauth2/consent`, {
		cookie,
		json: { accept: true, oauth_query: consentUrl.search.slice(1) },
	});
	const redirect = new URL(((await consent.json()) as { url: string }).url);
	const token = await req(s, `${AUTH}/oauth2/token`, {
		form: {
			grant_type: "authorization_code",
			client_id: clientId,
			code: redirect.searchParams.get("code")!,
			code_verifier: verifier,
			redirect_uri: REDIRECT_URI,
			resource: MCP_RESOURCE,
		},
	});
	return ((await token.json()) as { access_token: string }).access_token;
}
const oauth = await oauthToken();

// a project to work in, made straight in the database with audit logs on
const projectId = await createProject(s);
const schema = await import("@fluxify/server/src/db/schema");
await s.db
	.insert(schema.projectSettingsEntity)
	.values({ projectId, key: "auditLogs.enabled", value: "true" });
const { mintAgentToken } = await import("@fluxify/server/src/lib/agentToken");
const agent = mintAgentToken(admin.id, projectId);

// the same routes the real server mounts, over real HTTP
const { Hono } = await import("hono");
const { default: authRouter } = await import("@fluxify/server/src/api/auth/register");
const { mapVersionedAdminRoutes } = await import("@fluxify/server/src/api/register");
const { mapMcpServer } = await import("@fluxify/ai-gateway/src/mcp/index");
const app = new Hono<any>();
app.onError(s.server.errorHandler);
app.use("*", s.server.setSession);
authRouter.registerHandler(app);
mapVersionedAdminRoutes(app);
// no fetcher given: the MCP server reaches the admin API the way production does
mapMcpServer(app);
const server = Bun.serve({ port, fetch: (request) => app.fetch(request) });

console.log(
	`AUDIT_STACK ${JSON.stringify({
		url: `http://127.0.0.1:${server.port}`,
		pgUrl: process.env.PG_URL,
		natsContainer: "fluxify-mcp-auth-nats",
		projectId,
		admin: { id: admin.id, email },
		tokens: { cookie, pat, agent, oauth },
	})}`,
);

// stdin closes when the parent test finishes, or dies
for await (const _ of Bun.stdin.stream()) {
}
server.stop(true);
await stopAuthServer();
process.exit(0);
