import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/** One environment's stored OAuth connection, decrypted. `version` goes up with every write. Secrets: never log it. */
export type McpOAuthState = {
	tokens: OAuthTokens;
	client: OAuthClientInformationMixed;
	/** epoch ms the access token stops working, when the server said */
	expiresAt?: number;
	version: number;
};

/**
 * What the client needs to sign in with a stored connection. The client never
 * writes anywhere itself: whoever builds this plugs in the storage.
 */
export type McpOAuth = {
	/** The current state. Every client built from one `McpOAuth` shares it, so a refresh by one is seen by the rest. */
	state(): McpOAuthState;
	/**
	 * Saves refreshed tokens, only if the stored state is still `from` (compare-and-set).
	 * Resolves to the state in effect: the new one, or the winner's when another refresh landed first.
	 */
	onTokens(tokens: OAuthTokens, from: McpOAuthState): Promise<McpOAuthState>;
	/** Reads the stored state again and makes it the current one. */
	reload(): Promise<McpOAuthState>;
};

export const NOT_CONNECTED =
	"Not connected: a project admin has to connect this MCP server in Integrations";

/** How long a refused refresh waits for a concurrent refresh to be saved. */
const RELOAD_WAIT_MS = 1500;
const RELOAD_POLL_MS = 100;

export class McpNotConnectedError extends Error {
	constructor() {
		super(NOT_CONNECTED);
	}
}

/**
 * A provider that only refreshes. Signing in needs a person, so asking for it
 * means the connection is gone.
 */
export function mcpRefreshProvider(oauth: McpOAuth): OAuthClientProvider {
	// the state the SDK last read: the one a refresh started from
	let read = oauth.state();
	const redirectUrl = () =>
		String(
			(oauth.state().client as { redirect_uris?: string[] }).redirect_uris?.[0] ??
				"http://localhost/",
		);
	return {
		// set, or the SDK treats this as a non-interactive flow and skips refreshing
		get redirectUrl() {
			return redirectUrl();
		},
		get clientMetadata() {
			return { redirect_uris: [redirectUrl()], client_name: "Fluxify" };
		},
		clientInformation: () => oauth.state().client,
		tokens: () => {
			read = oauth.state();
			return read.tokens;
		},
		saveTokens: async (tokens) => {
			await oauth.onTokens(tokens, read);
		},
		// the refresh was refused: a concurrent one may have rotated the token. Wait for its result to
		// be saved, so the SDK's second try refreshes from that instead of the dead token.
		invalidateCredentials: async (scope) => {
			if (scope !== "tokens") return;
			for (let waited = 0; waited < RELOAD_WAIT_MS; waited += RELOAD_POLL_MS) {
				if ((await oauth.reload()).version > read.version) return;
				await new Promise((resolve) => setTimeout(resolve, RELOAD_POLL_MS));
			}
		},
		redirectToAuthorization: () => {
			throw new McpNotConnectedError();
		},
		saveCodeVerifier: () => {},
		codeVerifier: () => {
			throw new McpNotConnectedError();
		},
	};
}
