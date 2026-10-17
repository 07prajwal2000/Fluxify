import {
	auth,
	type OAuthClientProvider,
	UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
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

const expiring = (oauth: McpOAuth) => {
	const expiresAt = oauth.state().expiresAt;
	return !!expiresAt && Date.now() > expiresAt - EXPIRY_MARGIN_MS;
};

/** One refresh at a time per stored connection in this process: calls that arrive meanwhile wait for it. */
const refreshing = new WeakMap<McpOAuth, Promise<void>>();

/**
 * Makes sure the access token is good for the next call. If it is running out, the stored
 * tokens are read first, since another process may have refreshed already, and only
 * then is it refreshed here. A 401 later still refreshes, for a token revoked early.
 */
function ensureFresh(oauth: McpOAuth, provider: OAuthClientProvider, url: string) {
	const running = refreshing.get(oauth);
	if (running) return running;
	const work = (async () => {
		if (!expiring(oauth)) return;
		await oauth.reload();
		if (expiring(oauth)) await auth(provider, { serverUrl: url });
	})().finally(() => refreshing.delete(oauth));
	refreshing.set(oauth, work);
	return work;
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
	const fresh = async () => {
		if (oauth && authProvider) await ensureFresh(oauth, authProvider, url);
	};
	const client = new Client({ name: "fluxify", version: "1.0.0" });
	await guard(async () => {
		await fresh();
		await client.connect(
			new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers }, authProvider }),
		);
	});
	return {
		listTools: async () =>
			(
				await guard(async () => {
					await fresh();
					return client.listTools();
				})
			).tools,
		callTool: (name: string, args: Record<string, unknown>, signal?: AbortSignal) =>
			guard(async () => {
				await fresh();
				return client.callTool({ name, arguments: args }, undefined, { signal });
			}),
		close: () => client.close().catch(() => {}),
	};
}

export type McpClient = Awaited<ReturnType<typeof openMcpClient>>;
