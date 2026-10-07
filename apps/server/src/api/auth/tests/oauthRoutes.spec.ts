import { afterAll, describe, expect, it, spyOn } from "bun:test";
import * as env from "../../../lib/env";
import { onServerUrl } from "../oauthRoutes";

const envSpy = spyOn(env, "getEnv").mockImplementation(((key: string) =>
	key === "SERVER_URL" ? "http://fluxify.lan:8080" : undefined) as typeof env.getEnv);
afterAll(() => envSpy.mockRestore());

describe("onServerUrl", () => {
	it("keeps a plain-http server's scheme on the issuer and every endpoint", () => {
		const meta = onServerUrl({
			issuer: "https://fluxify.lan:8080/_/admin/api/auth",
			token_endpoint: "https://fluxify.lan:8080/_/admin/api/auth/oauth2/token",
			registration_endpoint: "http://10.0.0.5/_/admin/api/auth/oauth2/register",
			response_types_supported: ["code"],
		});
		expect(meta).toEqual({
			issuer: "http://fluxify.lan:8080/_/admin/api/auth",
			token_endpoint: "http://fluxify.lan:8080/_/admin/api/auth/oauth2/token",
			registration_endpoint: "http://fluxify.lan:8080/_/admin/api/auth/oauth2/register",
			response_types_supported: ["code"],
		});
	});
});
