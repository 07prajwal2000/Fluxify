import { afterAll, afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { hydrateAppConfig } from "../../../../loaders/appconfigLoader";
import {
	dns,
	fetchMarkdown,
	htmlToMarkdown,
	ingest,
	isPrivateIp,
	parseLlmsLinks,
	resolveHeaders,
	splitLlmsFull,
} from "../ingest";

const P = "kb-spec-project";
hydrateAppConfig(P, { DOCS_TOKEN: "s3cret" });

type Seen = { host: string | null; path: string; auth: string | null; method: string };
let seen: Seen[] = [];
let handler: (req: Request) => Response = () => new Response("");
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(req) {
		const u = new URL(req.url);
		seen.push({
			host: req.headers.get("host"),
			path: u.pathname,
			auth: req.headers.get("authorization"),
			method: req.method,
		});
		return handler(req);
	},
});
afterAll(() => server.stop(true));

/** `docs.test` and `other.test` are made-up names; only the mocked lookup knows them. */
const at = (host: string, path: string) => `http://${host}:${server.port}${path}`;
const DOCS = (path: string) => at("docs.test", path);
const OTHER = (path: string) => at("other.test", path);
let lookups: string[] = [];

beforeEach(() => {
	seen = [];
	lookups = [];
	// the local server is on loopback, so the private check is lifted for these
	process.env.KNOWLEDGE_ALLOW_PRIVATE_URLS = "true";
	spyOn(dns, "lookup").mockImplementation((async (host: string) => {
		lookups.push(host);
		return [{ address: "127.0.0.1", family: 4 }];
	}) as any);
});
afterEach(() => {
	delete process.env.KNOWLEDGE_ALLOW_PRIVATE_URLS;
	(dns.lookup as any).mockRestore?.();
});

const md = (body: string) => () =>
	new Response(body, { headers: { "content-type": "text/markdown" } });

describe("htmlToMarkdown", () => {
	it("converts headings, emphasis and code, and drops scripts", () => {
		const out = htmlToMarkdown(
			"<h1>Title</h1><script>evil()</script><h2>Part</h2><p>Some <strong>bold</strong> text.</p><pre><code>x = 1</code></pre>",
		);
		expect(out).toBe("# Title\n\n## Part\n\nSome **bold** text.\n\n```\nx = 1\n```");
	});
});

describe("resolveHeaders", () => {
	it("reads each value from app config", () => {
		expect(resolveHeaders(P, { authorization: "DOCS_TOKEN" })).toEqual({ authorization: "s3cret" });
	});

	it("names a missing key", () => {
		expect(() => resolveHeaders(P, { authorization: "NOPE" })).toThrow('"NOPE"');
	});
});

describe("ingest", () => {
	it("GETs a URL with the injected header and converts HTML", async () => {
		handler = () =>
			new Response("<h1>Hi</h1><p>there</p>", { headers: { "content-type": "text/html" } });
		const pages = await ingest(P, {
			type: "url",
			url: DOCS("/a"),
			headers: { authorization: "DOCS_TOKEN" },
			selectedPages: [],
		});
		expect(pages).toEqual([{ url: DOCS("/a"), markdown: "# Hi\n\nthere" }]);
		expect(seen).toEqual([
			{ host: `docs.test:${server.port}`, path: "/a", auth: "s3cret", method: "GET" },
		]);
	});

	it("passes Markdown through", async () => {
		handler = md("# Hi <b>raw</b>");
		const [page] = await ingest(P, { type: "url", url: DOCS("/a.md"), headers: {}, selectedPages: [] });
		expect(page.markdown).toBe("# Hi <b>raw</b>");
	});

	it("sends llms.txt credentials to its own origin only", async () => {
		handler = md("# Page");
		await ingest(P, {
			type: "llms_txt",
			url: DOCS("/llms.txt"),
			headers: { authorization: "DOCS_TOKEN" },
			selectedPages: [DOCS("/a.md"), OTHER("/b.md")],
		});
		expect(seen.find((s) => s.path === "/a.md")!.auth).toBe("s3cret");
		expect(seen.find((s) => s.path === "/b.md")!.auth).toBeNull();
	});

	it("fails on a non-2xx answer", async () => {
		handler = () => new Response("no", { status: 401 });
		await expect(
			ingest(P, { type: "url", url: DOCS("/a"), headers: {}, selectedPages: [] }),
		).rejects.toThrow("returned 401");
	});
});

describe("llms.txt parsing", () => {
	it("lists the linked pages, resolved and deduplicated", () => {
		const txt =
			"# Site\n\n## Docs\n\n- [Intro](/intro.md): start here\n- [API](https://x.dev/api.md)\n* [Intro again](/intro.md)\n\nSee [inline](/no.md).";
		expect(parseLlmsLinks(txt, "https://x.dev/llms.txt")).toEqual([
			{ title: "Intro", url: "https://x.dev/intro.md" },
			{ title: "API", url: "https://x.dev/api.md" },
		]);
	});

	it("splits llms-full.txt on h1 outside code, dropping url blocks", () => {
		const full =
			"---\nurl: /a.md\n---\n# A\n\ntext\n```\n# not a page\n```\n---\nurl: /b.md\n---\n# B\n\nmore";
		expect(splitLlmsFull(full)).toEqual(["# A\n\ntext\n```\n# not a page\n```", "# B\n\nmore"]);
	});
});

describe("private addresses", () => {
	it("knows private, loopback, link-local and ULA ranges", () => {
		for (const ip of [
			"127.0.0.1",
			"10.1.2.3",
			"172.16.0.1",
			"192.168.1.1",
			"169.254.169.254",
			"0.0.0.0",
			"100.64.0.1",
			"::1",
			"::",
			"fd00::1",
			"fe80::1",
			"::ffff:127.0.0.1",
		])
			expect(`${ip} ${isPrivateIp(ip)}`).toBe(`${ip} true`);
		for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"])
			expect(`${ip} ${isPrivateIp(ip)}`).toBe(`${ip} false`);
	});

	it("refuses private hosts and names that resolve to one, before connecting", async () => {
		delete process.env.KNOWLEDGE_ALLOW_PRIVATE_URLS;
		for (const url of ["http://127.0.0.1/a", "http://[::1]/a", "http://169.254.169.254/a", DOCS("/a")])
			await expect(fetchMarkdown(url, {})).rejects.toThrow("private or internal");
		expect(seen).toEqual([]);
	});

	it("refuses a redirect to a private address; the test flag only lets loopback through", async () => {
		handler = () =>
			new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
		await expect(fetchMarkdown(DOCS("/a"), {})).rejects.toThrow("169.254.169.254 is a private");
		expect(seen.map((s) => s.path)).toEqual(["/a"]);
	});

	it("follows a redirect and checks each hop, without the headers on another origin", async () => {
		handler = (req) =>
			new URL(req.url).pathname === "/a"
				? new Response(null, { status: 301, headers: { location: OTHER("/b") } })
				: new Response("# B");
		expect(await fetchMarkdown(DOCS("/a"), { authorization: "t" })).toBe("# B");
		expect(seen.map((s) => [s.host, s.auth])).toEqual([
			[`docs.test:${server.port}`, "t"],
			[`other.test:${server.port}`, null],
		]);
		expect(lookups).toEqual(["docs.test", "other.test"]);
	});

	it("connects to the address it checked: one lookup per hop, Host kept", async () => {
		handler = md("# pinned");
		expect(await fetchMarkdown(at("pinned.test", "/p"), {})).toBe("# pinned");
		// pinned.test exists nowhere: the only way to reach the server is the checked address
		expect(lookups).toEqual(["pinned.test"]);
		expect(seen[0].host).toBe(`pinned.test:${server.port}`);
	});
});

describe("size caps", () => {
	const stream = (type: string, bytes: number) => {
		let sent = 0;
		handler = () =>
			new Response(
				new ReadableStream({
					pull(c) {
						if (sent >= bytes) return c.close();
						sent += 64 * 1024;
						c.enqueue(new Uint8Array(64 * 1024).fill(97));
					},
				}),
				{ headers: { "content-type": type } },
			);
		return () => sent;
	};

	it("stops reading Markdown past 1 MB", async () => {
		const sent = stream("text/markdown", 50 * 1024 * 1024);
		await expect(fetchMarkdown(DOCS("/a.md"), {})).rejects.toThrow("larger than 1 MB");
		expect(sent()).toBeLessThan(20 * 1024 * 1024);
	});

	it("allows HTML up to 5 MB", async () => {
		stream("text/html", 2 * 1024 * 1024);
		expect((await fetchMarkdown(DOCS("/a"), {})).length).toBeGreaterThan(1024 * 1024);
		stream("text/html", 6 * 1024 * 1024);
		await expect(fetchMarkdown(DOCS("/a"), {})).rejects.toThrow("larger than 5 MB");
	});
});
