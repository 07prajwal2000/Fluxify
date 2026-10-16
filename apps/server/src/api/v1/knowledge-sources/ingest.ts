import { lookup } from "node:dns/promises";
import http, { type IncomingMessage } from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import TurndownService from "turndown";
import type { KnowledgePage } from "../../../db/schema";
import { BadRequestError } from "../../../errors/badRequestError";
import { getAppConfig } from "../../../loaders/appconfigLoader";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" }).remove([
	"script",
	"style",
	"noscript",
]);

export const htmlToMarkdown = (html: string) => turndown.turndown(html);

/** Header name -> app config key, resolved to the values. Never stored. */
export function resolveHeaders(projectId: string, headers: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(headers).map(([name, key]) => {
			const value = getAppConfig(projectId, key);
			if (value === undefined)
				throw new BadRequestError(`App config key "${key}" (header ${name}) does not exist`);
			return [name, String(value)];
		}),
	);
}

const MB = 1024 * 1024;
const MAX_REDIRECTS = 5;

/** Loopback, private, link-local (cloud metadata), CGNAT, ULA and unspecified addresses. */
export function isPrivateIp(ip: string): boolean {
	const v4 = ip.replace(/^::ffff:/i, "");
	if (isIP(v4) === 4) {
		const [a, b] = v4.split(".").map(Number);
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b < 128) ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b < 32) ||
			(a === 192 && b === 168)
		);
	}
	const x = ip.toLowerCase();
	return x === "::" || x === "::1" || /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
}

/** Swapped in tests to point a hostname at a local server. */
export const dns = { lookup };

type Pin = { address: string; family: number };

/**
 * Resolve the host once and refuse it when any address is private. The request
 * then connects to the returned address, so a second DNS answer (rebinding)
 * never reaches the network. Tests serving from localhost set
 * KNOWLEDGE_ALLOW_PRIVATE_URLS=true (loopback only); it is never set in prod.
 */
async function resolvePublic(url: URL): Promise<Pin> {
	if (url.protocol !== "http:" && url.protocol !== "https:")
		throw new Error(`Only http(s) URLs can be fetched: ${url.href}`);
	const host = url.hostname.replace(/^\[|\]$/g, "");
	const ips = isIP(host)
		? [{ address: host, family: isIP(host) }]
		: await dns.lookup(host, { all: true });
	if (!ips.length) throw new Error(`${url.host} does not resolve`);
	// test-only: lets loopback through, never any other private range
	const loopbackOk = process.env.KNOWLEDGE_ALLOW_PRIVATE_URLS === "true";
	const loopback = (ip: string) => /^(::ffff:)?127\./.test(ip) || ip === "::1";
	if (ips.some((a) => isPrivateIp(a.address) && !(loopbackOk && loopback(a.address))))
		throw new Error(`${url.host} is a private or internal address and cannot be fetched`);
	return ips[0];
}

/** One GET to `url`, connected to `pin`; Host and TLS servername stay the URL's host. */
function get(url: URL, pin: Pin, headers: Record<string, string>) {
	const lib = url.protocol === "https:" ? https : http;
	return new Promise<IncomingMessage>((resolve, reject) => {
		const req = lib.get(
			url,
			{
				headers,
				timeout: 30_000,
				lookup: (_host: string, opts: { all?: boolean }, cb: (...a: any[]) => void) =>
					opts?.all ? cb(null, [pin]) : cb(null, pin.address, pin.family),
			},
			resolve,
		);
		req.on("timeout", () => req.destroy(new Error(`GET ${url.href} timed out`)));
		req.on("error", reject);
	});
}

/** Read a body, stopping as soon as it passes `max` bytes. */
async function readCapped(res: IncomingMessage, max: number, url: string) {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of res) {
		size += chunk.length;
		if (size > max) {
			res.destroy();
			throw new Error(`${url} is larger than ${max / MB} MB`);
		}
		chunks.push(chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/**
 * GET one URL as Markdown: HTML (max 5 MB) is converted, anything else
 * (max 1 MB) passes through. Redirects are followed by hand so each hop is checked.
 */
export async function fetchMarkdown(url: string, headers: Record<string, string>) {
	let target = new URL(url);
	for (let hop = 0; ; hop++) {
		const res = await get(
			target,
			await resolvePublic(target),
			target.origin === new URL(url).origin ? headers : {},
		);
		const status = res.statusCode ?? 0;
		const location = res.headers.location;
		if (status >= 300 && status < 400 && location) {
			res.destroy();
			if (hop >= MAX_REDIRECTS) throw new Error(`${url} redirects too many times`);
			target = new URL(location, target);
			continue;
		}
		if (status < 200 || status >= 300) {
			res.destroy();
			throw new Error(`GET ${target.href} returned ${status}`);
		}
		const html = res.headers["content-type"]?.includes("text/html");
		const body = await readCapped(res, html ? 5 * MB : MB, target.href);
		return html ? htmlToMarkdown(body) : body;
	}
}

/** `- [Title](url)` links of an llms.txt, resolved against its URL. */
export function parseLlmsLinks(md: string, base: string) {
	const links = [...md.matchAll(/^\s*[-*]\s*\[([^\]]+)\]\(([^)\s]+)/gm)].map(([, title, href]) => ({
		title,
		url: new URL(href, base).href,
	}));
	return links.filter((l, i) => links.findIndex((x) => x.url === l.url) === i);
}

/**
 * An llms-full.txt is pages back to back: each starts at a `# ` heading
 * (outside code fences). `---` url/frontmatter blocks between pages are dropped.
 */
export function splitLlmsFull(md: string): string[] {
	const pages: string[][] = [[]];
	let fenced = false;
	for (const line of md
		.replace(/\r\n/g, "\n")
		.replace(/^---\n(?:[\w-]+:.*\n)+---\n/gm, "")
		.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
		if (!fenced && /^#\s/.test(line) && pages.at(-1)!.some((l) => l.trim())) pages.push([]);
		pages.at(-1)!.push(line);
	}
	return pages.map((p) => p.join("\n").trim()).filter(Boolean);
}

type Source = {
	type: string;
	url?: string | null;
	headers: Record<string, string>;
	selectedPages: string[];
	content?: string;
};

/** A source's pages as Markdown, fetched now with its headers injected. */
export async function ingest(projectId: string, s: Source): Promise<KnowledgePage[]> {
	if (s.type === "markdown") return [{ markdown: s.content ?? "" }];
	const headers = resolveHeaders(projectId, s.headers);
	const url = s.url!;
	switch (s.type) {
		case "url":
			return [{ url, markdown: await fetchMarkdown(url, headers) }];
		case "llms_full_txt":
			return splitLlmsFull(await fetchMarkdown(url, headers)).map((markdown) => ({ markdown }));
		default:
			return Promise.all(
				// credentials only go to the llms.txt's own origin
				s.selectedPages.map(async (u) => ({
					url: u,
					markdown: await fetchMarkdown(
						u,
						new URL(u).origin === new URL(url).origin ? headers : {},
					),
				})),
			);
	}
}
