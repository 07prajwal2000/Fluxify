import { afterEach, describe, expect, it } from "bun:test";
import { minVersion, resolveVersion } from "./npmPackageTypes";

const realFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = realFetch;
});

describe("minVersion", () => {
	it("takes the lowest version a range allows", () => {
		expect(minVersion("^1.2.3")).toBe("1.2.3");
		expect(minVersion("~5.26.4")).toBe("5.26.4");
		expect(minVersion(">=2.0.0-beta.1 <3")).toBe("2.0.0-beta.1");
		expect(minVersion("*")).toBe("latest");
	});
});

describe("resolveVersion", () => {
	it("resolves tags and ranges to an exact version", async () => {
		const requested: string[] = [];
		const exact = { "*": "26.6.5", latest: "26.6.5", "18": "18.19.130" };
		globalThis.fetch = ((url: string) => {
			requested.push(url);
			const specifier = new URL(url).searchParams.get("specifier") as keyof typeof exact;
			return Promise.resolve(new Response(JSON.stringify({ version: exact[specifier] })));
		}) as unknown as typeof fetch;

		expect(await resolveVersion("@types/node", "*")).toBe("26.6.5");
		expect(await resolveVersion("@types/node", "latest")).toBe("26.6.5");
		expect(await resolveVersion("@types/node", "18")).toBe("18.19.130");
		expect(requested).toEqual([
			"https://data.jsdelivr.com/v1/packages/npm/@types/node/resolved?specifier=*",
			"https://data.jsdelivr.com/v1/packages/npm/@types/node/resolved?specifier=latest",
			"https://data.jsdelivr.com/v1/packages/npm/@types/node/resolved?specifier=18",
		]);
	});

	it("leaves an exact version alone", async () => {
		globalThis.fetch = (() => {
			throw new Error("should not fetch");
		}) as unknown as typeof fetch;

		expect(await resolveVersion("@types/node", "18.19.130")).toBe("18.19.130");
	});
});
