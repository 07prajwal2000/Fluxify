export type McpOAuthState = {
	expiresAt?: number;
	[key: string]: unknown;
};

export interface McpOAuth {
	state(): McpOAuthState;
	reload(): Promise<void>;
	save(state: McpOAuthState): Promise<void>;
}

export const NOT_CONNECTED =
	"Not connected: a project admin has to connect this MCP server in Integrations";

export class McpNotConnectedError extends Error {
	override readonly name = "McpNotConnectedError";
	constructor() {
		super(NOT_CONNECTED);
	}
}

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

export type McpTool = {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	[key: string]: unknown;
};

export type McpToolCallResult = {
	content?: unknown;
	isError?: boolean;
	[key: string]: unknown;
};

/** Stored `{ key, value }` headers -> request headers, `cfg:KEY` values read from `appConfigs`. */
export function resolveMcpHeaders(
	headers: { key: string; value: string }[] = [],
	appConfigs: Map<string, string> | Record<string, string>,
): Record<string, string> {
	const get = (k: string) => (appConfigs instanceof Map ? appConfigs.get(k) : appConfigs[k]);
	return Object.fromEntries(
		headers.map((h) => [
			h.key,
			h.value.startsWith("cfg:") ? (get(h.value.slice(4)) ?? "") : h.value,
		]),
	);
}

/**
 * MCP client adapter interface.
 */
export interface McpAdapter {
	listTools(): Promise<McpTool[]>;
	callTool(
		name: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<McpToolCallResult>;
	close(): Promise<void> | void;
}

export type IMcpAdapter = McpAdapter;
export type McpClient = McpAdapter;

/** Inspect/metadata shape for MCP integrations. */
export type McpInspectResult = {
	tools?: McpTool[] | unknown[];
};

export type McpMetadata = McpInspectResult;
