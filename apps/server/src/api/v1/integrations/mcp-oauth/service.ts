import { randomBytes } from "node:crypto";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { z } from "zod";
import {
	CHAN_ON_INTEGRATION_CHANGE,
	publishMessage,
	setCacheEx,
	takeCacheKey,
} from "../../../../db/redis";
import { BadRequestError } from "../../../../errors/badRequestError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { getEnv } from "../../../../lib/env";
import { configForAdminEnv } from "../adminEnv";
import { getIntegrationByID } from "../get-by-id/repository";
import type { mcpVariantConfigSchema } from "../schemas";
import type { Env } from "./dto";
import { clearOAuth, type OAuthRow, readClient, saveClient, saveTokens } from "./store";

/** How long a sign-in may take: the state and the PKCE verifier are kept this long, and used once. */
export const STATE_TTL_SECONDS = 600;

type Pending = {
	projectId: string;
	integrationId: string;
	env: Env;
	userId: string;
	verifier: string;
};

const stateKey = (state: string) => `mcp-oauth:state:${state}`;

/** The server's own public address, never the request's `Host`. */
function serverUrl() {
	const url = getEnv("SERVER_URL")?.replace(/\/+$/, "");
	if (!url)
		throw new BadRequestError("SERVER_URL is not set, so there is no address to sign in back to");
	return url;
}

/** Where the MCP server sends the browser back to; the portal's base path does not apply to the API. */
const callbackUrl = (projectId: string) =>
	`${serverUrl()}/_/admin/api/v1/${projectId}/integrations/mcp-oauth/callback`;

/** The portal page the callback lands on. */
const portalUrl = (projectId: string, integrationId: string, result: "connected" | "error") =>
	`${serverUrl()}/_/admin/ui/${projectId}/integrations/${integrationId}?mcpOAuth=${result}`;

/** An mcp integration set to sign in with OAuth, and the config of the environment being connected. */
async function load(projectId: string, id: string, env: Env) {
	const row = await getIntegrationByID(projectId, id);
	if (!row) throw new NotFoundError("Integration not found");
	if (row.group !== "mcp") throw new BadRequestError("Only MCP servers sign in with OAuth");
	if (env === "development" && row.syncDev) {
		throw new BadRequestError(
			"Development uses production's connection. Connect production instead.",
		);
	}
	const config = configForAdminEnv(row, env) as z.infer<typeof mcpVariantConfigSchema>;
	if (config.auth !== "oauth") throw new BadRequestError("Set the sign-in to OAuth and save first");
	return { row, config };
}

/** The SDK's sign-in provider for one connect or callback. Its storage is this integration's `oauth`. */
function signInProvider(
	row: OAuthRow,
	env: Env,
	redirectUrl: string,
	client: OAuthClientInformationMixed | undefined,
	flow: { state?: string; verifier?: string; authorizationUrl?: URL },
): OAuthClientProvider {
	return {
		redirectUrl,
		clientMetadata: {
			redirect_uris: [redirectUrl],
			client_name: "Fluxify",
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
		},
		state: () => flow.state!,
		clientInformation: () => client,
		saveClientInformation: async (registered) => {
			client = registered;
			await saveClient(row, env, registered);
		},
		// a sign-in starts from nothing: a stored token would be refreshed instead
		tokens: () => undefined,
		saveTokens: async (tokens) => {
			await saveTokens(row, env, tokens);
		},
		redirectToAuthorization: (url) => {
			flow.authorizationUrl = url;
		},
		saveCodeVerifier: (verifier) => {
			flow.verifier = verifier;
		},
		codeVerifier: () => flow.verifier!,
	};
}

/**
 * What the person sees when the sign in cannot start. Never the SDK's own message: for a server
 * with no OAuth it can hold that server's whole error page.
 */
const CANNOT_START =
	"Failed to connect. This MCP server may not support OAuth, or it could not be reached.";

/** Step 1: registers a client if there is none, and returns the address to send the person to. */
export async function connect(projectId: string, id: string, env: Env, userId: string) {
	const { row, config } = await load(projectId, id, env);
	const redirectUrl = callbackUrl(projectId);
	// registered once: reused while it still names this callback address
	const stored = readClient(config);
	const client = (stored as { redirect_uris?: string[] } | undefined)?.redirect_uris?.includes(
		redirectUrl,
	)
		? stored
		: undefined;
	const flow: { state?: string; verifier?: string; authorizationUrl?: URL } = {
		state: randomBytes(32).toString("base64url"),
	};
	const result = await auth(signInProvider(row, env, redirectUrl, client, flow), {
		serverUrl: config.url,
	}).catch(() => {
		throw new BadRequestError(CANNOT_START);
	});
	if (result !== "REDIRECT" || !flow.authorizationUrl) throw new BadRequestError(CANNOT_START);
	const pending: Pending = {
		projectId,
		integrationId: id,
		env,
		userId,
		verifier: flow.verifier!,
	};
	await setCacheEx(stateKey(flow.state!), JSON.stringify(pending), STATE_TTL_SECONDS);
	return { authorizationUrl: flow.authorizationUrl.toString() };
}

/**
 * Step 2, the browser coming back. The state is used up as it is read, so a
 * second visit finds nothing, and it must be this project's, this person's.
 * Resolves to where to send the browser.
 */
export async function callback(
	projectId: string,
	userId: string,
	query: { state: string; code?: string; error?: string },
) {
	const raw = await takeCacheKey(stateKey(query.state));
	const pending = raw ? (JSON.parse(raw) as Pending) : undefined;
	if (!pending) {
		throw new BadRequestError(
			"This sign in expired or was already used. Start again with Connect.",
		);
	}
	if (pending.projectId !== projectId || pending.userId !== userId) {
		throw new ForbiddenError("This sign in was started by someone else");
	}
	const done = (result: "connected" | "error") =>
		portalUrl(projectId, pending.integrationId, result);
	if (query.error || !query.code) return done("error");
	try {
		const { row, config } = await load(projectId, pending.integrationId, pending.env);
		const flow = { verifier: pending.verifier };
		await auth(signInProvider(row, pending.env, callbackUrl(projectId), readClient(config), flow), {
			serverUrl: config.url,
			authorizationCode: query.code,
		});
	} catch {
		return done("error");
	}
	await publishMessage(CHAN_ON_INTEGRATION_CHANGE, pending.integrationId);
	return done("connected");
}

/** Forgets the environment's client and tokens. Nothing is called on the MCP server. */
export async function disconnect(projectId: string, id: string, env: Env) {
	const { row } = await load(projectId, id, env);
	await clearOAuth(row, env);
	await publishMessage(CHAN_ON_INTEGRATION_CHANGE, id);
	return { connected: false };
}
