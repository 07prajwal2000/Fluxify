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
});
