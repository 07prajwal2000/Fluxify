// Load: 500 users for 3 minutes using real ids sampled from the DB
// (config/ids.txt; a mix of cached and uncached) plus ids that do not exist (miss cache AND DB).
import http from "k6/http";
import { check } from "k6";
import { SharedArray } from "k6/data";

const BASE = __ENV.BASE_URL || "http://urls.localhost:8080";
const JSON_H = { "Content-Type": "application/json" };
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ids = new SharedArray("ids", () => open("../config/ids.txt").split("\n").filter(Boolean));
const missing = http.expectedStatuses(404);

export const options = {
	// Skip per-request DNS: a local k6 on Windows fails lookups of *.localhost under load.
	hosts: { "urls.localhost": "127.0.0.1", "ts.localhost": "127.0.0.1", "node.localhost": "127.0.0.1" },
	stages: [
		{ duration: "20s", target: 500 },
		{ duration: "2m30s", target: 500 },
		{ duration: "10s", target: 0 },
	],
	// Observe, do not abort: the point is to see where it bends.
	thresholds: {
		http_req_failed: ["rate<0.01"],
		http_req_duration: ["p(95)<500"],
		"http_req_duration{endpoint:redirect}": ["p(95)<500"],
		"http_req_duration{endpoint:get}": ["p(95)<500"],
		"http_req_duration{endpoint:create}": ["p(95)<500"],
	},
};

const known = () => ids[Math.floor(Math.random() * ids.length)];
const unknown = () => Array.from({ length: 7 }, () => ALPHABET[Math.floor(Math.random() * 62)]).join("");

export default function () {
	const roll = Math.random() * 100;
	if (roll < 45) {
		const r = http.get(`${BASE}/r/${known()}`, { redirects: 0, tags: { name: "/r/:id", endpoint: "redirect", case: "known" } });
		check(r, { "redirect 302": (r) => r.status === 302 });
	} else if (roll < 65) {
		const r = http.get(`${BASE}/api/urls/${known()}`, { tags: { name: "/api/urls/:id", endpoint: "get", case: "known" } });
		check(r, { "get 200": (r) => r.status === 200 });
	} else if (roll < 80) {
		const r = http.get(`${BASE}/r/${unknown()}`, { redirects: 0, tags: { name: "/r/:id", endpoint: "redirect", case: "unknown" }, responseCallback: missing });
		check(r, { "redirect unknown 404": (r) => r.status === 404 });
	} else if (roll < 85) {
		const r = http.get(`${BASE}/api/urls/${unknown()}`, { tags: { name: "/api/urls/:id", endpoint: "get", case: "unknown" }, responseCallback: missing });
		check(r, { "get unknown 404": (r) => r.status === 404 });
	} else {
		const r = http.post(`${BASE}/api/urls`, JSON.stringify({ url: `https://example.com/stress/${Math.random()}` }), {
			headers: JSON_H,
			tags: { endpoint: "create", case: "valid" },
		});
		check(r, { "create 201": (r) => r.status === 201 });
	}
}
