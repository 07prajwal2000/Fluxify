// 1-minute load test: 80% redirect, 15% get by id, 5% create.
import http from "k6/http";
import { check } from "k6";

const BASE = __ENV.BASE_URL || "http://urls.localhost:8080";
const JSON_H = { headers: { "Content-Type": "application/json" } };

export const options = {
	stages: [
		{ duration: "10s", target: 50 },
		{ duration: "40s", target: 50 },
		{ duration: "10s", target: 0 },
	],
	thresholds: {
		http_req_failed: ["rate<0.01"],
		http_req_duration: ["p(95)<500"],
	},
};

// Pre-seed a pool of ids for the read endpoints.
export function setup() {
	const ids = [];
	for (let i = 0; i < 200; i++) {
		const r = http.post(`${BASE}/api/urls`, JSON.stringify({ url: `https://example.com/seed/${i}` }), JSON_H);
		ids.push(r.json("id"));
	}
	return { ids };
}

export default function (data) {
	const roll = Math.random();
	const id = data.ids[Math.floor(Math.random() * data.ids.length)];
	if (roll < 0.8) {
		const r = http.get(`${BASE}/r/${id}`, { redirects: 0, tags: { name: "redirect" } });
		check(r, { "redirect 302": (r) => r.status === 302 && !!r.headers.Location });
	} else if (roll < 0.95) {
		const r = http.get(`${BASE}/api/urls/${id}`, { tags: { name: "get" } });
		check(r, { "get 200": (r) => r.status === 200 && !!r.json("url") });
	} else {
		const r = http.post(`${BASE}/api/urls`, JSON.stringify({ url: `https://example.com/${Math.random()}` }), {
			...JSON_H,
			tags: { name: "create" },
		});
		check(r, { "create 201": (r) => r.status === 201 && !!r.json("id") });
	}
}
