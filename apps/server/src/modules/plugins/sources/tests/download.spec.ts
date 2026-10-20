import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { assertTrustedUrl, downloadTrusted, isTrustedHost } from "../download";
import { hashFiles, sha256Integrity, verifyIntegrity } from "../integrity";
import { MAX_TARBALL_BYTES } from "../limits";

describe("trusted domains", () => {
	it("matches an exact host, ignoring case and a trailing dot", () => {
		expect(isTrustedHost("Plugins.Acme.dev.", ["plugins.acme.dev"])).toBe(true);
		expect(isTrustedHost("evil.acme.dev", ["plugins.acme.dev"])).toBe(false);
		expect(isTrustedHost("acme.dev", ["plugins.acme.dev"])).toBe(false);
	});
	it("matches subdomains of a *. entry, at any depth, but not the bare domain", () => {
		const trusted = ["*.acme.dev"];
		expect(isTrustedHost("plugins.acme.dev", trusted)).toBe(true);
		expect(isTrustedHost("a.b.acme.dev", trusted)).toBe(true);
		expect(isTrustedHost("acme.dev", trusted)).toBe(false);
	});
	it("does not match a host that merely ends with the same letters", () => {
		expect(isTrustedHost("evilacme.dev", ["*.acme.dev"])).toBe(false);
		expect(isTrustedHost("acme.dev.evil.com", ["acme.dev", "*.acme.dev"])).toBe(false);
	});
	it("refuses everything when nothing is trusted", () => {
		expect(() => assertTrustedUrl("https://acme.dev/p.tgz", [])).toThrow("No trusted domains");
	});
});

describe("assertTrustedUrl", () => {
	const trusted = ["acme.dev"];
	it("accepts an https URL on a trusted host", () => {
		expect(assertTrustedUrl("https://acme.dev/p.tgz", trusted).hostname).toBe("acme.dev");
	});
	it("refuses http", () => {
		expect(() => assertTrustedUrl("http://acme.dev/p.tgz", trusted)).toThrow("https://");
	});
	it("refuses an untrusted host, naming it", () => {
		expect(() => assertTrustedUrl("https://evil.dev/p.tgz", trusted)).toThrow("evil.dev");
	});
	it("refuses credentials in the URL", () => {
		expect(() => assertTrustedUrl("https://u:p@acme.dev/p.tgz", trusted)).toThrow("credentials");
	});
	it("refuses a string that is not a URL", () => {
		expect(() => assertTrustedUrl("not a url", trusted)).toThrow("not a URL");
	});
	it("is not fooled by a trusted name in the userinfo or path", () => {
		expect(() => assertTrustedUrl("https://acme.dev@evil.dev/p.tgz", trusted)).toThrow();
		expect(() => assertTrustedUrl("https://evil.dev/acme.dev", trusted)).toThrow("evil.dev");
	});
});

describe("downloadTrusted", () => {
	const stub = () => spyOn(globalThis, "fetch");
	let fetches: ReturnType<typeof stub>;
	// restored after each test: a stubbed fetch must not reach the next spec file
	beforeEach(() => {
		fetches = stub();
	});
	afterEach(() => mock.restore());

	const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

	it("downloads from a trusted host", async () => {
		fetches.mockResolvedValueOnce(new Response("tarball"));
		const bytes = await downloadTrusted("https://acme.dev/p.tgz", ["acme.dev"]);
		expect(new TextDecoder().decode(bytes)).toBe("tarball");
	});
	it("follows a redirect to another trusted host", async () => {
		fetches
			.mockResolvedValueOnce(redirect("https://cdn.acme.dev/p.tgz"))
			.mockResolvedValueOnce(new Response("tarball"));
		const bytes = await downloadTrusted("https://acme.dev/p.tgz", ["acme.dev", "*.acme.dev"]);
		expect(new TextDecoder().decode(bytes)).toBe("tarball");
		expect(fetches).toHaveBeenCalledTimes(2);
	});
	it("refuses a redirect to an untrusted host without calling it", async () => {
		fetches.mockResolvedValueOnce(redirect("https://evil.dev/p.tgz"));
		await expect(downloadTrusted("https://acme.dev/p.tgz", ["acme.dev"])).rejects.toThrow(
			"evil.dev is not a trusted domain",
		);
		expect(fetches).toHaveBeenCalledTimes(1);
	});
	it("refuses a redirect downgraded to http", async () => {
		fetches.mockResolvedValueOnce(redirect("http://acme.dev/p.tgz"));
		await expect(downloadTrusted("https://acme.dev/p.tgz", ["acme.dev"])).rejects.toThrow("https://");
	});
	it("resolves a relative redirect against the current URL", async () => {
		fetches.mockResolvedValueOnce(redirect("/other.tgz")).mockResolvedValueOnce(new Response("x"));
		await downloadTrusted("https://acme.dev/p.tgz", ["acme.dev"]);
		expect(String(fetches.mock.calls[1]![0])).toBe("https://acme.dev/other.tgz");
	});
	it("gives up on a redirect loop", async () => {
		fetches.mockImplementation(async () => redirect("https://acme.dev/again.tgz"));
		await expect(downloadTrusted("https://acme.dev/p.tgz", ["acme.dev"])).rejects.toThrow(
			"Too many redirects",
		);
	});
	it("refuses a download over the size cap by its Content-Length", async () => {
		fetches.mockResolvedValueOnce(
			new Response("x", { headers: { "content-length": String(MAX_TARBALL_BYTES + 1) } }),
		);
		await expect(downloadTrusted("https://acme.dev/p.tgz", ["acme.dev"])).rejects.toThrow(
			"larger than",
		);
	});
	it("surfaces a failing host", async () => {
		fetches.mockResolvedValueOnce(new Response("no", { status: 500 }));
		await expect(downloadTrusted("https://acme.dev/p.tgz", ["acme.dev"])).rejects.toThrow(
			"answered 500",
		);
	});
});

describe("integrity", () => {
	const bytes = new TextEncoder().encode("hello");
	it("accepts the bytes it was computed from", () => {
		expect(() => verifyIntegrity(bytes, sha256Integrity(bytes))).not.toThrow();
	});
	it("refuses other bytes", () => {
		expect(() => verifyIntegrity(new TextEncoder().encode("hellO"), sha256Integrity(bytes))).toThrow(
			"does not match",
		);
	});
	it("checks a sha512 hash like npm's, and every listed hash we understand", () => {
		const sha512 = `sha512-${new Bun.CryptoHasher("sha512").update(bytes).digest("base64")}`;
		expect(() => verifyIntegrity(bytes, sha512)).not.toThrow();
		expect(() => verifyIntegrity(bytes, `${sha512} ${sha256Integrity(bytes)}`)).not.toThrow();
		expect(() => verifyIntegrity(bytes, `${sha512} sha256-AAAA`)).toThrow("does not match");
	});
	it("refuses an integrity string it cannot check", () => {
		expect(() => verifyIntegrity(bytes, "md5-AAAA")).toThrow("no integrity hash");
	});
	it("hashes a directory by path and content, in any order", () => {
		const a = new Map([["a", new Uint8Array([1])], ["b", new Uint8Array([2])]]);
		const reordered = new Map([["b", new Uint8Array([2])], ["a", new Uint8Array([1])]]);
		expect(hashFiles(a)).toBe(hashFiles(reordered));
		expect(hashFiles(new Map([["a", new Uint8Array([1])], ["b", new Uint8Array([3])]]))).not.toBe(
			hashFiles(a),
		);
		// the same bytes under another name, or moved between files
		expect(hashFiles(new Map([["a", new Uint8Array([1])], ["c", new Uint8Array([2])]]))).not.toBe(
			hashFiles(a),
		);
		expect(hashFiles(new Map([["ab", new Uint8Array([1, 2])]]))).not.toBe(
			hashFiles(new Map([["a", new Uint8Array([1])], ["b", new Uint8Array([2])]])),
		);
	});
});
