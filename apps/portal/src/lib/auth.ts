import { ssoClient } from "@better-auth/sso/client";
import { createAuthClient } from "better-auth/react";

// baseURL omitted in dev so requests hit the current origin and go through the
// Vite proxy (see vite.config.ts). Override with VITE_SERVER_URL if needed.
export const authClient = createAuthClient({
	basePath: "/_/admin/api/auth/",
	baseURL: import.meta.env.VITE_SERVER_URL,
	sessionOptions: {
		refetchInterval: 2 * 60 * 1000,
		refetchOnWindowFocus: false,
	},
	// Auth calls skip the axios client, so the 429 retry in lib/http.ts doesn't
	// cover them. Without this, a rate-limited getSession() in the route guard
	// reads as "no session" and bounces the user to /login.
	fetchOptions: {
		retry: { type: "linear", attempts: 3, delay: 1000, shouldRetry: (res) => res?.status === 429 },
	},
	plugins: [ssoClient()],
});
