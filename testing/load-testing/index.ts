// ============================================================================
// k6 load-test runner. Single-file standalone version.
//
//   k6 run index.js
//   k6 run -e BASE_URL=https://api.example.com index.js
// ============================================================================
import http from "k6/http";
import { check, sleep } from "k6";

/** Base URL every request path is appended to. Override with -e BASE_URL=... */
const baseUrl = "http://localhost:5603";

/** The requests exercised on every iteration. */
const requests = [
  {
    name: "health",
    method: "GET",
    path: "/users",
    // We pass a function to generate dynamic query parameters on every execution
    query: () => ({ id: Math.floor(Math.random() * 10) + 1 }),
    expectStatus: 200,
  },
];

/** k6 execution profile — Fast 1-minute high-load test */
export const options = {
  stages: [
    { duration: "20s", target: 100 }, // Fast ramp up to 100 virtual users
    { duration: "30s", target: 100 }, // Hold at 100 users to watch CPU/RAM
    { duration: "10s", target: 0 }, // Fast ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors
    http_req_duration: ["p(95)<500"], // 95% of requests under 500ms
  },
};

// --- Init stage: preload every file-based body ONCE. ---
const fileBodies = {};
for (const r of requests) {
  if (r.bodyFile && fileBodies[r.bodyFile] === undefined) {
    fileBodies[r.bodyFile] = open(r.bodyFile);
  }
}

function buildUrl(spec) {
  let url = baseUrl.replace(/\/$/, "") + spec.path;

  // Evaluate the query if it is a function, otherwise use it as an object
  const q = typeof spec.query === "function" ? spec.query() : spec.query;

  if (q && Object.keys(q).length > 0) {
    const qs = Object.keys(q)
      .map(
        (k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(q[k]))}`,
      )
      .join("&");
    url += (url.indexOf("?") === -1 ? "?" : "&") + qs;
  }
  return url;
}

function resolveBody(spec) {
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

    const headers = {};
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

  // sleep(1);
}
