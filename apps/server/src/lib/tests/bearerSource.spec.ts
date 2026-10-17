import { describe, expect, it } from "bun:test";
import { bearerSource } from "../bearerAuth";

const none = new Headers();
const viaMcp = new Headers({ "x-fluxify-via": "mcp" });

describe("bearerSource", () => {
	it("labels a personal access token pat", () => {
		expect(bearerSource("flx_abc", none)).toBe("pat");
	});

	it("labels an agent run token agent", () => {
		expect(bearerSource("fxa_abc", none)).toBe("agent");
	});

	it("labels any other bearer, an OAuth access token, mcp", () => {
		expect(bearerSource("eyJhbGciOi.payload.sig", none)).toBe("mcp");
	});

	it("labels a personal token the MCP server forwarded mcp", () => {
		expect(bearerSource("flx_abc", viaMcp)).toBe("mcp");
		expect(bearerSource("fxa_abc", viaMcp)).toBe("mcp");
	});

	it("reads the header without regard to case, and only the value mcp", () => {
		expect(bearerSource("flx_abc", new Headers({ "x-fluxify-via": "MCP" }))).toBe("mcp");
		expect(bearerSource("flx_abc", new Headers({ "x-fluxify-via": "portal" }))).toBe("pat");
	});
});
