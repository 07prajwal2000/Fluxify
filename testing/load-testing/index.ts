// ============================================================================
// k6 load-test runner. Config-driven — everything about WHAT to hit lives in
// config.ts; this file only decides HOW to send it.
//
//   k6 run --compatibility-mode=experimental_enhanced index.ts
//   k6 run --compatibility-mode=experimental_enhanced -e BASE_URL=https://api.example.com index.ts
//
// The enhanced compatibility mode is REQUIRED — it enables the esbuild loader
// that transpiles TypeScript/ESM. Without it k6 fails to parse the types.
// Tip: export K6_COMPATIBILITY_MODE=experimental_enhanced to skip the flag.
// For editor IntelliSense: bun add -d @types/k6
// ============================================================================
import http from "k6/http";
import { check, sleep } from "k6";
import { baseUrl, requests, options as cfgOptions, type RequestSpec } from "./config.ts";

// k6 globals available only at init time.
declare function open(path: string): string;

export const options = cfgOptions;

// --- Init stage: preload every file-based body ONCE. k6's open() can only run
// here (not inside the default function), so we read all referenced files up
// front and reuse the strings across iterations. ---
const fileBodies: Record<string, string> = {};
for (const r of requests) {
	if (r.bodyFile && fileBodies[r.bodyFile] === undefined) {
		fileBodies[r.bodyFile] = open(r.bodyFile);
	}
}

function buildUrl(spec: RequestSpec): string {
	let url = baseUrl.replace(/\/$/, "") + spec.path;
	const q = spec.query;
	if (q && Object.keys(q).length > 0) {
		const qs = Object.keys(q)
			.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(q[k]))}`)
			.join("&");
		url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
	}
	return url;
}

function resolveBody(spec: RequestSpec): {
	body: string | null;
	contentType: string | null;
} {
	// File body wins over inline. Content type is inferred from the extension.
	if (spec.bodyFile) {
		const isJson = spec.bodyFile.toLowerCase().endsWith(".json");
		return {
			body: fileBodies[spec.bodyFile],
			contentType: isJson ? "application/json" : "text/plain",
		};
	}
	if (spec.body === undefined || spec.body === null) {
		return { body: null, contentType: null };
	}
	if (typeof spec.body === "string") {
		return { body: spec.body, contentType: "text/plain" };
	}
	return { body: JSON.stringify(spec.body), contentType: "application/json" };
}

export default function () {
	for (const spec of requests) {
		const url = buildUrl(spec);
		const { body, contentType } = resolveBody(spec);

		const headers: Record<string, string> = {};
		if (contentType) headers["Content-Type"] = contentType;
		if (spec.headers) {
			for (const k in spec.headers) headers[k] = spec.headers[k];
		}

		const res = http.request(spec.method, url, body, {
			headers,
			tags: { name: spec.name },
		});

		const expected = spec.expectStatus ?? 200;
		check(res, {
			[`${spec.name} -> ${expected}`]: (r) => r.status === expected,
		});
	}

	sleep(1);
}
