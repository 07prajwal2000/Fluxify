// Wide mix of user behaviour, picked per iteration by weight (sums to 100).
// Every request is tagged `endpoint` (create|get|redirect) and `case` (the variation).
import http from "k6/http";
import { check, sleep } from "k6";

const BASE = __ENV.BASE_URL || "http://urls.localhost:8080";
const JSON_H = { "Content-Type": "application/json" };
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const rejected = http.expectedStatuses(400);
const missing = http.expectedStatuses(404);

export const options = {
	stages: [
		{ duration: "10s", target: 50 },
		{ duration: "40s", target: 50 },
		{ duration: "10s", target: 0 },
	],
	thresholds: {
		http_req_failed: ["rate<0.01"],
		http_req_duration: ["p(95)<500"],
		"http_req_duration{endpoint:create}": ["p(95)<500"],
		"http_req_duration{endpoint:get}": ["p(95)<500"],
		"http_req_duration{endpoint:redirect}": ["p(95)<500"],
	},
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const unknownId = () => Array.from({ length: 7 }, () => ALPHABET[Math.floor(Math.random() * 62)]).join("");
// Popular links get most of the traffic: r^3 skews picks toward the front of the pool.
const hotId = (ids) => ids[Math.floor(Math.random() ** 3 * ids.length)];
const coldId = (ids) => pick(ids);

const post = (body, tags, extra = {}) =>
	http.post(`${BASE}/api/urls`, typeof body === "string" ? body : JSON.stringify(body), {
		headers: JSON_H,
		tags: { endpoint: "create", ...tags },
		...extra,
	});
const get = (id, tags, extra = {}) =>
	http.get(`${BASE}/api/urls/${id}`, { tags: { endpoint: "get", ...tags }, ...extra });
const redirect = (id, tags, extra = {}) =>
	http.get(`${BASE}/r/${id}`, { redirects: 0, tags: { endpoint: "redirect", ...tags }, ...extra });

const ok201 = (r) => r.status === 201 && !!r.json("id");
const ok200 = (r) => r.status === 200 && !!r.json("url");
const ok302 = (r) => r.status === 302 && !!r.headers.Location;

// Valid URLs of different shapes.
const validUrls = [
	() => `https://example.com/${Math.random()}`,
	() => `http://example.org/path/to/page?utm_source=k6&ref=${Math.random()}`,
	() => `https://example.com/search?q=${"a".repeat(200)}&n=${Math.random()}`,
	() => `https://example.com/${"seg/".repeat(300)}${Math.random()}`, // ~1.2 KB
	() => `https://example.com/caf%C3%A9/%E6%97%A5%E6%9C%AC?x=${Math.random()}#frag`,
	() => `https://user:pw@example.com:8443/a/b?c=d&e=f#g${Math.random()}`,
];
// Bodies the API must reject with 400.
const badBodies = [
	() => ({ url: "nope" }),
	() => ({ url: "" }),
	() => ({ url: "ftp://example.com/file" }),
	() => ({ url: "example.com/no-scheme" }),
	() => ({}),
	() => ({ url: `https://example.com/${"x".repeat(2100)}` }),
	() => "{not json",
];
// Ids that are not 7 base62 chars: must 404 without a lookup.
const malformedIds = ["bad", "ABCDEFGH", "ab-cdef", "%20%20%20", "0000000000"];

const behaviours = [
	[20, "create_valid", () => check(post({ url: pick(validUrls)() }, { case: "create_valid" }), { "create 201": ok201 })],
	[
		10,
		"create_then_use", // a user shortens a link, then checks it and opens it
		() => {
			const c = post({ url: `https://example.com/mine/${Math.random()}` }, { case: "journey_create" });
			if (!check(c, { "journey create 201": ok201 })) return;
			const id = c.json("id");
			sleep(Math.random() * 0.05);
			check(get(id, { case: "journey_get" }), { "journey get 200": ok200 });
			check(redirect(id, { case: "journey_redirect" }), { "journey redirect 302": ok302 });
		},
	],
	[
		3,
		"create_invalid",
		() =>
			check(post(pick(badBodies)(), { case: "create_invalid" }, { responseCallback: rejected }), {
				"create invalid 400": (r) => r.status === 400,
			}),
	],
	[15, "get_hot", (d) => check(get(hotId(d.ids), { case: "get_hot" }), { "get 200": ok200 })],
	[
		3,
		"get_unknown",
		() =>
			check(get(unknownId(), { case: "get_unknown" }, { responseCallback: missing }), {
				"get unknown 404": (r) => r.status === 404,
			}),
	],
	[
		2,
		"get_malformed",
		() =>
			check(get(pick(malformedIds), { case: "get_malformed" }, { responseCallback: missing }), {
				"get malformed 404": (r) => r.status === 404,
			}),
	],
	[30, "redirect_hot", (d) => check(redirect(hotId(d.ids), { case: "redirect_hot" }), { "redirect 302": ok302 })],
	[10, "redirect_cold", (d) => check(redirect(coldId(d.ids), { case: "redirect_cold" }), { "redirect cold 302": ok302 })],
	[
		5,
		"redirect_unknown",
		() =>
			check(redirect(unknownId(), { case: "redirect_unknown" }, { responseCallback: missing }), {
				"redirect unknown 404": (r) => r.status === 404,
			}),
	],
	[
		2,
		"redirect_malformed",
		() =>
			check(redirect(pick(malformedIds), { case: "redirect_malformed" }, { responseCallback: missing }), {
				"redirect malformed 404": (r) => r.status === 404,
			}),
	],
];

export function setup() {
	const ids = [];
	for (let i = 0; i < 500; i++) {
		const r = http.post(`${BASE}/api/urls`, JSON.stringify({ url: `https://example.com/seed/${i}` }), { headers: JSON_H });
		ids.push(r.json("id"));
	}
	return { ids };
}

export default function (data) {
	let roll = Math.random() * 100;
	for (const [weight, , run] of behaviours) {
		if ((roll -= weight) < 0) return run(data);
	}
}
