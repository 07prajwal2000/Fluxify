import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { assertNatsVersion, MIN_NATS_VERSION } from "../nats";

const root = join(import.meta.dir, "../../../../..");
const read = (path: string) => Bun.file(join(root, path)).text();

describe("assertNatsVersion", () => {
	it("accepts the minimum and newer", () => {
		expect(() => assertNatsVersion(MIN_NATS_VERSION)).not.toThrow();
		expect(() => assertNatsVersion("2.15.0")).not.toThrow();
		expect(() => assertNatsVersion("3.0.0")).not.toThrow();
	});

	it("rejects older or unknown servers", () => {
		expect(() => assertNatsVersion("2.11.11")).toThrow(/2\.11\.11 is too old/);
		expect(() => assertNatsVersion("2.13.9")).toThrow();
		expect(() => assertNatsVersion(undefined)).toThrow();
	});
});

// The Helm values pin the NATS tag; every other place that runs NATS copies it.
describe("NATS version matches the Helm chart", async () => {
	const values = await read("deploy/helm/fluxify/values.yaml");
	const tag = values.match(/^nats:[\s\S]*?^ {4}image:\s*\n\s+tag:\s*(\S+)/m)?.[1];

	it("Helm pins a tag at or above the minimum", () => {
		expect(tag).toBeDefined();
		expect(() => assertNatsVersion(tag!.replace(/-.*$/, ""))).not.toThrow();
	});

	it.each([
		"docker-compose.yml",
		"docker/kit/docker-compose.yml",
		"docker/production/docker-compose.yml",
		"docker/kit/Dockerfile",
		"testing/e2e/src/nats.ts",
	])("%s uses the same tag", async (path) => {
		const refs = [...(await read(path)).matchAll(/\bnats:(\d[\w.-]*)/g)].map((m) => m[1]);
		expect(refs.length).toBeGreaterThan(0);
		for (const ref of refs) expect(ref).toBe(tag!);
	});
});
