import { McpNotConnectedError, type McpOAuth, type McpOAuthState } from "@fluxify/adapters";
import { logger } from "@fluxify/common";
import type {
	OAuthClientInformationMixed,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../../../db";
import { integrationsEntity } from "../../../../db/schema";
import { EncryptionService } from "../../../../lib/encryption";
import type { FluxifyEnv } from "../../../../lib/env";
import { pickValue } from "../../../../lib/envValues";

// An mcp integration's OAuth connection lives in its config, under `oauth`, one
// per environment (`config` is production, `devConfig` is development). Client
// and tokens are encrypted; what the portal may show is not.
type StoredOAuth = {
	/** goes up with every write; a refresh saves only if it is still the one it read */
	v: number;
	/** the registered client (encrypted) */
	client?: string;
	/** the tokens (encrypted); missing while only the client is registered */
	tokens?: string;
	expiresAt?: number | null;
	scope?: string | null;
};

/** The row fields the connection depends on. */
export type OAuthRow = {
	id: string;
	projectId: string | null;
	config: unknown;
	devConfig?: unknown;
	syncDev?: boolean | null;
};

/** What every read returns in place of `oauth`. Never the tokens. */
export type OAuthStatus = { connected: boolean; expiresAt?: number; scope?: string };

const seal = (value: unknown) => EncryptionService.encrypt(JSON.stringify(value));
const unseal = <T>(value: string) => JSON.parse(EncryptionService.decrypt(value)) as T;

/** Which stored config an environment reads and writes: development has its own unless it shares production's. */
const columnFor = (row: OAuthRow, env: FluxifyEnv) =>
	env === "development" && !row.syncDev ? "devConfig" : "config";

const oauthOf = (config: unknown) => (config as { oauth?: StoredOAuth } | null)?.oauth;

export function oauthStatus(oauth: StoredOAuth | undefined): OAuthStatus {
	return {
		connected: !!oauth?.tokens,
		...(oauth?.tokens && oauth.expiresAt ? { expiresAt: oauth.expiresAt } : {}),
		...(oauth?.tokens && oauth.scope ? { scope: oauth.scope } : {}),
	};
}

/** `config` as an API may return it: `oauth` replaced by its status. */
export function redactOAuth<T>(config: T): T {
	if (!config || typeof config !== "object" || !("oauth" in config)) return config;
	return { ...config, oauth: oauthStatus(oauthOf(config)) };
}

/** A whole row (or the rows an update returns) with the tokens taken out of both configs. */
export function redactIntegration<T>(row: T): T {
	if (Array.isArray(row)) return row.map(redactIntegration) as T;
	const r = row as { config?: unknown; devConfig?: unknown } | null;
	if (!r || typeof r !== "object") return row;
	return { ...r, config: redactOAuth(r.config), devConfig: redactOAuth(r.devConfig) } as T;
}

/** Decrypts a stored connection; undefined when it has no tokens or cannot be read (key changed). */
function decode(oauth: StoredOAuth | undefined): McpOAuthState | undefined {
	if (!oauth?.tokens || !oauth.client) return undefined;
	try {
		return {
			tokens: unseal<OAuthTokens>(oauth.tokens),
			client: unseal<OAuthClientInformationMixed>(oauth.client),
			expiresAt: oauth.expiresAt ?? undefined,
			version: oauth.v,
		};
	} catch {
		// never the cause: it can carry the ciphertext
		logger.warn("[mcp-oauth] stored connection could not be decrypted", "MCP");
		return undefined;
	}
}

export function readClient(config: unknown) {
	const stored = oauthOf(config)?.client;
	try {
		return stored ? unseal<OAuthClientInformationMixed>(stored) : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Writes part of the environment's `oauth` in one UPDATE and bumps its version.
 * With `expect`, only if the stored version is still that one (compare-and-set);
 * returns whether the row was written.
 */
export async function writeOAuth(
	row: OAuthRow,
	env: FluxifyEnv,
	patch: Partial<StoredOAuth>,
	expect?: number,
) {
	const column = integrationsEntity[columnFor(row, env)];
	const version = sql`(coalesce(${column}->'oauth'->>'v', '0')::int + 1)`;
	const merged = sql`coalesce(${column}->'oauth', '{}'::jsonb) || ${JSON.stringify(patch)}::text::jsonb || jsonb_build_object('v', ${version})`;
	const written = await db
		.update(integrationsEntity)
		.set({ [columnFor(row, env)]: sql`jsonb_set(${column}, '{oauth}', ${merged})` })
		.where(
			and(
				eq(integrationsEntity.id, row.id),
				eq(integrationsEntity.projectId, row.projectId!),
				expect === undefined ? undefined : sql`${column}->'oauth'->>'v' = ${String(expect)}`,
			),
		)
		.returning({ id: integrationsEntity.id });
	return written.length > 0;
}

/** Removes the environment's `oauth`: its client and tokens. */
export async function clearOAuth(row: OAuthRow, env: FluxifyEnv) {
	const column = integrationsEntity[columnFor(row, env)];
	await db
		.update(integrationsEntity)
		.set({ [columnFor(row, env)]: sql`${column} - 'oauth'` })
		.where(
			and(eq(integrationsEntity.id, row.id), eq(integrationsEntity.projectId, row.projectId!)),
		);
}

/** Saves the client the server registered for us, so a later Connect does not register again. */
export const saveClient = (row: OAuthRow, env: FluxifyEnv, client: OAuthClientInformationMixed) =>
	writeOAuth(row, env, { client: seal(client) });

/** Saves a fresh sign-in's tokens. */
export function saveTokens(row: OAuthRow, env: FluxifyEnv, tokens: OAuthTokens, expect?: number) {
	return writeOAuth(
		row,
		env,
		{
			tokens: seal(tokens),
			expiresAt: tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : null,
			scope: tokens.scope ?? null,
		},
		expect,
	);
}

async function readStored(row: OAuthRow, env: FluxifyEnv) {
	const [fresh] = await db
		.select()
		.from(integrationsEntity)
		.where(
			and(eq(integrationsEntity.id, row.id), eq(integrationsEntity.projectId, row.projectId!)),
		);
	return fresh ? oauthOf(fresh[columnFor(row, env)]) : undefined;
}

/**
 * The stored connection of `env` as the client uses it, or undefined while not
 * connected. It is the only code that reads the tokens back, and it hands them
 * to the client, never to a response.
 *
 * The state lives in this closure, so every client built from one `McpOAuth`
 * shares it. A refresh writes with compare-and-set: if another refresh got its
 * tokens saved first, this one adopts the stored tokens instead of its own.
 */
export function mcpOAuthFor(row: OAuthRow, env: FluxifyEnv): McpOAuth | undefined {
	let current = decode(oauthOf(pickValue(env, row.syncDev ?? false, row.config, row.devConfig)));
	if (!current) return undefined;
	const reload = async () => {
		const stored = decode(await readStored(row, env));
		if (!stored) throw new McpNotConnectedError();
		current = stored;
		return stored;
	};
	return {
		state: () => current!,
		reload,
		onTokens: async (tokens, from) => {
			if (!(await saveTokens(row, env, tokens, from.version))) return reload();
			const expiresAt = tokens.expires_in ? Date.now() + tokens.expires_in * 1000 : undefined;
			current = { ...from, tokens, expiresAt, version: from.version + 1 };
			return current;
		},
	};
}
