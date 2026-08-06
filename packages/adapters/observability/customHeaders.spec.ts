import { describe, it, expect } from "bun:test";
import { resolveCustomHeaders } from "./customHeaders";

describe("resolveCustomHeaders", () => {
	const appConfig = new Map<string, string>([["DD_KEY", "secret-token"]]);

	it("passes literal values through", () => {
		expect(resolveCustomHeaders({ "X-Tenant": "acme" }, appConfig)).toEqual({
			"X-Tenant": "acme",
		});
	});

	it("dereferences cfg: values", () => {
		expect(resolveCustomHeaders({ "DD-API-KEY": "cfg:DD_KEY" }, appConfig)).toEqual({
			"DD-API-KEY": "secret-token",
		});
	});

	it("strips exactly the cfg: prefix", () => {
		// the observability adapters used substring(3), which left a ":" on the key
		// and made every cfg: reference silently resolve to nothing
		expect(resolveCustomHeaders({ h: "cfg:DD_KEY" }, new Map([[":DD_KEY", "x"]]))).toEqual(
			{},
		);
	});

	it("drops a reference that resolves to nothing rather than sending it empty", () => {
		// an empty api key header reads as a wrong credential at the far end, which
		// is far harder to debug than an absent one
		expect(resolveCustomHeaders({ "DD-API-KEY": "cfg:MISSING" }, appConfig)).toEqual({});
	});

	it("accepts a plain object app config, not just a Map", () => {
		expect(resolveCustomHeaders({ h: "cfg:DD_KEY" }, { DD_KEY: "from-object" })).toEqual({
			h: "from-object",
		});
	});

	it("handles no headers at all", () => {
		expect(resolveCustomHeaders(undefined, appConfig)).toEqual({});
	});
});
