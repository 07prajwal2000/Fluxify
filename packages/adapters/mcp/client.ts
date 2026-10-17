import { auth, UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
	StreamableHTTPClientTransport,
	StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { McpNotConnectedError, type McpOAuth, mcpRefreshProvider } from "./oauth";

/**
 * An `mcp` integration's config with its headers resolved. Header values are secrets: never log them.
 * `auth: "oauth"` signs in with `oauth` instead; it is missing while nobody has connected.
 */
export type McpConnection = {
	url: string;
	headers?: Record<string, string>;
	auth?: "oauth";
	oauth?: McpOAuth;
};

/** Refresh this long before the access token runs out, so a call never starts with one about to die. */
const EXPIRY_MARGIN_MS = 30_000;

/** Stored `{ key, value }` headers -> request headers, `cfg:KEY` values read from `appConfigs`. */
export function resolveMcpHeaders(
	headers: { key: string; value: string }[] = [],
	appConfigs: Map<string, string>,
) {
	return Object.fromEntries(
		headers.map((h) => [
			h.key,
			h.value.startsWith("cfg:") ? (appConfigs.get(h.value.slice(4)) ?? "") : h.value,
		]),
	);
}

const authFailed = (e: unknown) =>
	e instanceof UnauthorizedError ||
	e instanceof OAuthError ||
	(e instanceof StreamableHTTPError && e.code === 401);

/**
 * Connects over Streamable HTTP. Close it when done.
 * With OAuth, a rejected or expired token is refreshed once and the call retried once (the SDK does
 * both); a connection that cannot be refreshed fails with `McpNotConnectedError`.
 */
export async function openMcpClient({ url, headers = {}, auth: mode, oauth }: McpConnection) {
	if (mode === "oauth" && !oauth) throw new McpNotConnectedError();
	const authProvider = oauth && mcpRefreshProvider(oauth);
	const guard = async <T>(work: () => Promise<T>) =>
		work().catch((e) => {
			throw authProvider && authFailed(e) ? new McpNotConnectedError() : e;
		});
	const client = new Client({ name: "fluxify", version: "1.0.0" });
	await guard(async () => {
		// the token's own expiry saves a failed round trip; a 401 covers one revoked early
		const expiresAt = oauth?.state().expiresAt;
		if (authProvider && expiresAt && Date.now() > expiresAt - EXPIRY_MARGIN_MS) {
			await auth(authProvider, { serverUrl: url });
		}
		await client.connect(
			new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers }, authProvider }),
		);
	});
	return {
		listTools: async () => (await guard(() => client.listTools())).tools,
		callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
			guard(() => client.callTool({ name, arguments: args }, undefined, { signal })),
		close: () => client.close().catch(() => {}),
	};
}

export type McpClient = Awaited<ReturnType<typeof openMcpClient>>;
