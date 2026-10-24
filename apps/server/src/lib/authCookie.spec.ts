import { afterAll, expect, it, spyOn } from "bun:test";
import type { DB } from "better-auth/adapters/drizzle";
import { initializeAuth } from "./auth";
import * as env from "./env";

// spyOn, not mock.module: module mocks leak into every other spec in the run.
// CI has no .env, so the server URL and secret are set here.
const savedSecret = process.env.BETTER_AUTH_SECRET;
process.env.BETTER_AUTH_SECRET = "test-secret-for-cookie-spec";
const envSpy = spyOn(env, "getEnv").mockImplementation((key) =>
	key === "SERVER_URL" ? "http://fluxify.test" : undefined,
);
afterAll(() => {
	envSpy.mockRestore();
	if (savedSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
	else process.env.BETTER_AUTH_SECRET = savedSecret;
});

const sessionCookie = async () => (await initializeAuth({} as DB).$context).authCookies.sessionToken;

it("names the session cookie after the product, not the auth library", async () => {
	const { name } = await sessionCookie();
	expect(name).toEndWith("fluxify.session_token");
	expect(name).not.toContain("better-auth");
});

it("sends the session cookie to admin requests only", async () => {
	expect((await sessionCookie()).attributes.path).toBe("/_/admin/");
});
