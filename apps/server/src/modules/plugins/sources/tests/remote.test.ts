// Plugin sources from the network (#858) against a real Postgres and NATS: npm
// and URL plugins arrive only through their checks, and a URL is never fetched
// before a creator approves it. HTTP is mocked, everything else is real.
import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { readAsWorker, keyOf, sameBytes, setTrusted, setup, startStack, stopStack } from "./stack";
import { pluginTgz, VERSION } from "./tarball";

beforeAll(async () => {
	await startStack("remote");
}, 240_000);
afterAll(stopStack);
afterEach(() => setTrusted([]));

describe("npm", () => {
	/** the web as the npm source sees it: jsDelivr, the registry and its tarball host */
	const web = new Map<string, () => Response>();
	const SPEC = `@acme/echo@${VERSION}`;
	const JSDELIVR = `https://cdn.jsdelivr.net/npm/@acme/echo@${VERSION}/fluxify.json`;
	const PACKUMENT = "https://registry.npmjs.org/@acme%2fecho";
	const TARBALL = `https://registry.npmjs.org/@acme/echo/-/echo-${VERSION}.tgz`;
	const sri = (bytes: Uint8Array) => `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
	const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
	const calls: string[] = [];

	/** a registry that has `tgz` published `age` days ago */
	function publish(tgz = pluginTgz(), age = 30, integrity = sri(tgz)) {
		web.set(JSDELIVR, () => new Response("{}"));
		web.set(PACKUMENT, () =>
			Response.json({
				time: { [VERSION]: daysAgo(age) },
				versions: { [VERSION]: { dist: { tarball: TARBALL, integrity } } },
			}),
		);
		web.set(TARBALL, () => new Response(tgz as BodyInit));
		return tgz;
	}

	const original = globalThis.fetch;
	const install = () =>
		spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) => {
			const url = String(input instanceof Request ? input.url : input);
			calls.push(url);
			return web.get(url)?.() ?? new Response("not found", { status: 404 });
		}) as typeof fetch);
	afterEach(() => {
		web.clear();
		calls.length = 0;
		globalThis.fetch = original;
	});

	it("adds an exact version: manifest checked, registry integrity recorded, pending", async () => {
		install();
		const tgz = publish();
		const s = await setup();
		const res = await s.post("/npm", { spec: SPEC });
		expect(res.status).toBe(200);
		expect(res.body).toMatchObject({
			name: "acme/echo",
			version: VERSION,
			source: "npm",
			location: SPEC,
			integrity: sri(tgz),
			approval: "pending",
		});
	});

	it.each([
		["a range", "@acme/echo@^2026.10.2001"],
		["a tag", "@acme/echo@latest"],
		["no version", "@acme/echo"],
		["a partial version", "@acme/echo@2026.10"],
		["a prerelease", "@acme/echo@2026.10.2001-beta.1"],
	])("refuses %s", async (_, spec) => {
		install();
		publish();
		const s = await setup();
		const res = await s.post("/npm", { spec });
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("exact version");
		expect(calls).toHaveLength(0);
	});

	it("refuses a package with no fluxify.json, downloading nothing", async () => {
		install();
		publish();
		web.set(JSDELIVR, () => new Response("Couldn't find the requested file", { status: 404 }));
		const s = await setup();
		const res = await s.post("/npm", { spec: SPEC });
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("not a Fluxify plugin");
		expect(calls).toEqual([JSDELIVR]);
		expect(await s.rows()).toHaveLength(0);
	});

	it("refuses a tarball that does not match the registry's integrity", async () => {
		install();
		publish(pluginTgz(), 30, sri(new TextEncoder().encode("something else")));
		const s = await setup();
		const res = await s.post("/npm", { spec: SPEC });
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("does not match");
		expect(await s.rows()).toHaveLength(0);
	});

	it("waits out the project's release age rule", async () => {
		install();
		publish(pluginTgz(), 2);
		const s = await setup();
		const res = await s.post("/npm", { spec: SPEC });
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("less than 7 days ago");
		expect(calls).not.toContain(TARBALL);

		const { projectSettingsCache } = await import("../../../../loaders/projectSettingsLoader");
		projectSettingsCache[s.project] = { "settings.packages.minReleaseAgeDays": "3" } as never;
		expect((await s.post("/npm", { spec: SPEC })).status).toBe(400);
		projectSettingsCache[s.project] = { "settings.packages.minReleaseAgeDays": "1" } as never;
		expect((await s.post("/npm", { spec: SPEC })).status).toBe(200);
	});

	it("refuses a version the registry does not have", async () => {
		install();
		publish();
		const s = await setup();
		const res = await s.post("/npm", { spec: "@acme/echo@2026.1.1" });
		expect(res.status).toBe(400);
		expect(await s.rows()).toHaveLength(0);
	});

	it("refuses a package whose package.json disagrees with the version asked for", async () => {
		install();
		publish(
			pluginTgz({
				"package.json": JSON.stringify({
					version: "2026.10.2002",
					fluxify: { name: "acme/echo", url: "https://github.com/acme/fluxify-echo" },
				}),
			}),
		);
		const s = await setup();
		const res = await s.post("/npm", { spec: SPEC });
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("2026.10.2002");
	});

	it("needs a creator", async () => {
		install();
		publish();
		const s = await setup();
		expect((await s.post("/npm", { spec: SPEC }, "viewer")).status).toBe(403);
	});
});

describe("url", () => {
	const URL_ = "https://plugins.acme.dev/echo.tgz";
	const original = globalThis.fetch;
	afterEach(() => {
		globalThis.fetch = original;
	});
	const serve = (handler: (url: string) => Response) =>
		spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL) =>
			handler(String(input instanceof Request ? input.url : input))) as typeof fetch);

	it("refuses an untrusted host and http, recording nothing", async () => {
		const s = await setup();
		setTrusted(["acme.dev"]);
		const untrusted = await s.post("/url", { url: "https://evil.dev/echo.tgz" });
		expect(untrusted.status).toBe(400);
		expect(untrusted.body.message).toContain("evil.dev is not a trusted domain");
		expect((await s.post("/url", { url: "http://acme.dev/echo.tgz" })).status).toBe(400);
		expect((await s.get("/url/list")).body).toEqual([]);
	});

	it("refuses every URL while no domain is trusted", async () => {
		const s = await setup();
		const res = await s.post("/url", { url: URL_ });
		expect(res.status).toBe(400);
		expect(res.body.message).toContain("No trusted domains");
	});

	it("records step 1 without downloading, then fetches only when a creator says so", async () => {
		const s = await setup();
		const tgz = pluginTgz();
		const fetched: string[] = [];
		serve((url) => {
			fetched.push(url);
			return new Response(tgz as BodyInit);
		});
		setTrusted(["*.acme.dev"]);

		const step1 = await s.post("/url", { url: URL_ });
		expect(step1.status).toBe(200);
		expect(step1.body).toMatchObject({ status: "awaiting_fetch", url: URL_, pluginName: null });
		expect(fetched).toEqual([]);
		expect(await s.rows()).toHaveLength(0);
		expect(await readAsWorker(keyOf(s.project))).toBeNull();

		expect((await s.post(`/url/${step1.body.id}/fetch`, undefined, "viewer")).status).toBe(403);
		expect(fetched).toEqual([]);

		const step2 = await s.post(`/url/${step1.body.id}/fetch`, undefined);
		expect(step2.status).toBe(200);
		expect(fetched).toEqual([URL_]);
		expect(step2.body).toMatchObject({
			name: "acme/echo",
			source: "url",
			location: `${keyOf(s.project)} ${URL_}`,
			approval: "pending",
		});
		expect(step2.body.integrity).toBe(
			`sha256-${new Bun.CryptoHasher("sha256").update(tgz).digest("base64")}`,
		);
		const stored = await readAsWorker(keyOf(s.project));
		expect(sameBytes(stored, tgz)).toBe(true);
		expect((await s.get("/url/list")).body[0]).toMatchObject({
			status: "fetched",
			pluginName: "acme/echo",
			fetchedBy: s.as.user,
		});
		expect((await s.post(`/url/${step1.body.id}/fetch`, undefined)).status).toBe(400);
	});

	it("refuses a redirect to an untrusted host and marks the request failed", async () => {
		const s = await setup();
		const asked: string[] = [];
		serve((url) => {
			asked.push(url);
			return new Response(null, { status: 302, headers: { location: "https://evil.dev/echo.tgz" } });
		});
		setTrusted(["acme.dev", "*.acme.dev"]);
		const step1 = await s.post("/url", { url: URL_ });
		const step2 = await s.post(`/url/${step1.body.id}/fetch`, undefined);
		expect(step2.status).toBe(400);
		expect(step2.body.message).toContain("evil.dev is not a trusted domain");
		expect(asked).toEqual([URL_]);
		const [request] = (await s.get("/url/list")).body;
		expect(request.status).toBe("failed");
		expect(request.lastError).toContain("evil.dev");
		expect(await s.rows()).toHaveLength(0);
	});

	it("rechecks the domain at fetch time, and allows a retry after a failure", async () => {
		const s = await setup();
		const tgz = pluginTgz();
		let status = 500;
		serve(() => (status === 200 ? new Response(tgz as BodyInit) : new Response("no", { status })));
		setTrusted(["*.acme.dev"]);
		const step1 = await s.post("/url", { url: URL_ });

		setTrusted([]);
		const untrusted = await s.post(`/url/${step1.body.id}/fetch`, undefined);
		expect(untrusted.status).toBe(400);
		expect(untrusted.body.message).toContain("No trusted domains");

		setTrusted(["*.acme.dev"]);
		expect((await s.post(`/url/${step1.body.id}/fetch`, undefined)).body.message).toContain("answered 500");
		status = 200;
		expect((await s.post(`/url/${step1.body.id}/fetch`, undefined)).status).toBe(200);
	});

	it("keeps a request inside its project", async () => {
		const a = await setup();
		const b = await setup();
		setTrusted(["*.acme.dev"]);
		const step1 = await a.post("/url", { url: URL_ });
		expect((await b.post(`/url/${step1.body.id}/fetch`, undefined)).status).toBe(404);
	});
});

