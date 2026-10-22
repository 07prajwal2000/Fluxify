// Mixed user behaviour, picked per iteration:
//   30% create a URL | 25% look up by id | 45% follow a short link (5% of those miss)
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE_URL || "http://urls.localhost:8080";
const JSON_H = { "Content-Type": "application/json" };
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const missOk = http.expectedStatuses(404);

export const options = {
	stages: [
		{ duration: "10s", target: 50 },
		{ duration: "40s", target: 50 },
		{ duration: "10s", target: 0 },
	],
	thresholds: {
		http_req_failed: ["rate<0.01"],
		http_req_duration: ["p(95)<500"],
		"http_req_duration{name:redirect}": ["p(95)<500"],
		"http_req_duration{name:get}": ["p(95)<500"],
		"http_req_duration{name:create}": ["p(95)<500"],
	},
};

// Random 7-char id; a hit in a pool of 62^7 ids is effectively impossible, so it is always unknown.
function unknownId() {
	let id = "";
	for (let i = 0; i < 7; i++) id += ALPHABET[Math.floor(Math.random() * 62)];
	return id;
}

export function setup() {
	const ids = [];
	for (let i = 0; i < 200; i++) {
		const r = http.post(`${BASE}/api/urls`, JSON.stringify({ url: `https://example.com/seed/${i}` }), { headers: JSON_H });
		ids.push(r.json("id"));
	}
	return { ids };
}

export default function (data) {
	const roll = Math.random();
	const id = data.ids[Math.floor(Math.random() * data.ids.length)];

	if (roll < 0.3) {
		const r = http.post(`${BASE}/api/urls`, JSON.stringify({ url: `https://example.com/${Math.random()}` }), {
			headers: JSON_H,
			tags: { name: "create" },
		});
		check(r, { "create 201": (r) => r.status === 201 && !!r.json("id") });
	} else if (roll < 0.55) {
		const r = http.get(`${BASE}/api/urls/${id}`, { tags: { name: "get" } });
		check(r, { "get 200": (r) => r.status === 200 && !!r.json("url") });
	} else if (Math.random() < 0.05) {
		const r = http.get(`${BASE}/r/${unknownId()}`, { redirects: 0, tags: { name: "redirect" }, responseCallback: missOk });
		check(r, { "redirect miss 404": (r) => r.status === 404 });
	} else {
		const r = http.get(`${BASE}/r/${id}`, { redirects: 0, tags: { name: "redirect" } });
		check(r, { "redirect 302": (r) => r.status === 302 && !!r.headers.Location });
	}
}
