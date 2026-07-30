// ============================================================================
// Load-test configuration.
// Add one entry per API you want to hit. Each request declares its method, path,
// optional query params, and a body that is EITHER inline (object or raw string)
// OR loaded from a file in ./data (raw JSON or raw text).
//
// Override the target at runtime:  k6 run -e BASE_URL=https://api.example.com index.js
// ============================================================================

/** Base URL every request path is appended to. */
export const baseUrl = __ENV.BASE_URL || "http://localhost:8080";

/** The requests exercised on every iteration. */
export const requests = [
  {
    name: "health",
    method: "GET",
    path: "/users",
    expectStatus: 200,
  },
  // {
  // 	name: "list-users",
  // 	method: "GET",
  // 	path: "/api/users",
  // 	query: { page: 1, limit: 20 },
  // },
  // {
  // 	// Inline JSON body.
  // 	name: "create-user-inline",
  // 	method: "POST",
  // 	path: "/api/users",
  // 	body: { name: "Load Test", email: "load@test.dev" },
  // 	expectStatus: 201,
  // },
  // {
  // 	// Body loaded from a JSON file in ./data.
  // 	name: "create-order-from-file",
  // 	method: "POST",
  // 	path: "/api/orders",
  // 	bodyFile: "data/create-order.json",
  // 	expectStatus: 201,
  // },
  // {
  // 	// Raw (non-JSON) body loaded from a file.
  // 	name: "ingest-raw",
  // 	method: "POST",
  // 	path: "/api/ingest",
  // 	bodyFile: "data/raw-payload.txt",
  // 	headers: { "Content-Type": "text/csv" },
  // },
];

/** k6 execution profile — tune VUs / stages / thresholds here. */
export const options = {
  stages: [
    { duration: "30s", target: 10 }, // ramp up to 10 virtual users
    { duration: "1m", target: 10 }, // hold
    { duration: "10s", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% errors
    http_req_duration: ["p(95)<500"], // 95% of requests under 500ms
  },
};
