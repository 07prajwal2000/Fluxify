import { expect, it } from "bun:test";
import type { DB } from "better-auth/adapters/drizzle";
import { initializeAuth } from "./auth";

it("names the session cookie after the product, not the auth library", async () => {
	const { authCookies } = await initializeAuth({} as DB).$context;
	expect(authCookies.sessionToken.name).toEndWith("fluxify.session_token");
	expect(authCookies.sessionToken.name).not.toContain("better-auth");
});

it("sends the session cookie to admin requests only", async () => {
	const { authCookies } = await initializeAuth({} as DB).$context;
	expect(authCookies.sessionToken.attributes.path).toBe("/_/admin/");
});
