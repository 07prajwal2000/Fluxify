import { BadRequestError } from "../../../errors/badRequestError";
import { FETCH_TIMEOUT_MS, MAX_TARBALL_BYTES } from "./limits";

/** Reads a response body, refusing to hold more than `max` bytes (a lying `Content-Length` included). */
export async function readCapped(res: Response, max = MAX_TARBALL_BYTES): Promise<Uint8Array> {
	const tooBig = () =>
		new BadRequestError(`The download is larger than ${max / 1024 / 1024} MB; that is the limit`);
	if (Number(res.headers.get("content-length")) > max) throw tooBig();
	const chunks: Uint8Array[] = [];
	let total = 0;
	const reader = res.body?.getReader();
	if (!reader) return new Uint8Array();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.length;
		if (total > max) {
			await reader.cancel();
			throw tooBig();
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks);
}

/**
 * Whether `host` is allowed by a trusted-domains list. An entry is an exact
 * host (`plugins.acme.dev`) or `*.acme.dev`, which matches any subdomain at any
 * depth but not `acme.dev` itself: list the bare domain too to allow it.
 */
export function isTrustedHost(host: string, trusted: readonly string[]) {
	const name = host.toLowerCase().replace(/\.$/, "");
	return trusted.some((entry) => {
		const pattern = entry.toLowerCase();
		return pattern.startsWith("*.") ? name.endsWith(pattern.slice(1)) : name === pattern;
	});
}

/** The URL as a trusted source: `https://`, no credentials, and a host on the list. Throws otherwise. */
export function assertTrustedUrl(raw: string, trusted: readonly string[]): URL {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new BadRequestError(`'${raw}' is not a URL`);
	}
	if (url.protocol !== "https:") throw new BadRequestError("Only https:// URLs are accepted");
	if (url.username || url.password)
		throw new BadRequestError("The URL must not contain credentials");
	if (!isTrustedHost(url.hostname, trusted))
		throw new BadRequestError(
			trusted.length
				? `${url.hostname} is not a trusted domain. An instance admin can add it under Instance settings, Plugins.`
				: "No trusted domains are set, so no plugin can be fetched from a URL. An instance admin can add one under Instance settings, Plugins.",
		);
	return url;
}

const MAX_REDIRECTS = 5;

/**
 * Downloads a tarball from a trusted URL. Every hop of a redirect is checked
 * like the first, so a trusted host cannot hand the admin on to an untrusted one.
 */
export async function downloadTrusted(raw: string, trusted: readonly string[]) {
	let url = assertTrustedUrl(raw, trusted);
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const res = await fetch(url, {
			redirect: "manual",
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		const location = res.headers.get("location");
		if (res.status >= 300 && res.status < 400 && location) {
			await res.body?.cancel();
			url = assertTrustedUrl(new URL(location, url).href, trusted);
			continue;
		}
		if (!res.ok) throw new BadRequestError(`${url.hostname} answered ${res.status}`);
		return readCapped(res);
	}
	throw new BadRequestError("Too many redirects");
}
