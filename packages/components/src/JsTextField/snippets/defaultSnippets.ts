import type { CodeSnippet } from "./types";

export const DEFAULT_SNIPPETS: CodeSnippet[] = [
	// 1. Request Data Access (Most frequent first step in backend scripts)
	{
		id: "request-body",
		title: "Request Body Access",
		description: "Access typed request body payload",
		category: "request",
		code: `const body = getRequestBody();`,
		tags: ["request", "body", "payload"],
	},
	{
		id: "query-param-default",
		title: "Query Param with Default",
		description: "Read a query parameter or fallback to default value",
		category: "params",
		code: `const query = getQueryParam("key") || "default";`,
		tags: ["params", "query", "fallback"],
	},
	{
		id: "route-param-required",
		title: "Route Param Guard",
		description: "Get route parameter and throw if missing",
		category: "params",
		code: `const id = getRouteParam("id");
if (!id) {
  throw new Error("Missing required route parameter 'id'");
}`,
		tags: ["params", "route", "guard", "id"],
	},

	// 2. Validation & Config Guards (Standard precondition checks)
	{
		id: "zod-validate",
		title: "Zod Schema Validation",
		description: "Validate input or body using bundled Zod library",
		category: "validation",
		code: `const schema = libs.zod.object({
  email: libs.zod.string().email(),
  name: libs.zod.string().min(1),
  role: libs.zod.enum(["admin", "user"]).default("user"),
});

const result = schema.safeParse(getRequestBody());
if (!result.success) {
  throw new Error(\`Validation error: \${result.error.issues.map((i) => i.message).join(", ")}\`);
}
return result.data;`,
		tags: ["zod", "validation", "schema", "libs"],
	},
	{
		id: "config-required-guard",
		title: "Required App Config Guard",
		description: "Fetch project App Config variable and throw if missing",
		category: "config",
		code: `const secretKey = getConfig("STRIPE_SECRET_KEY");
if (!secretKey) {
  throw new Error("Missing required config: STRIPE_SECRET_KEY");
}`,
		tags: ["config", "secret", "guard"],
	},

	// 3. Database & HTTP APIs (Primary backend integrations)
	{
		id: "db-parameterized-query",
		title: "Parameterized SQL Query",
		description: "Run safe parameterized SQL query with $1, $2 placeholders",
		category: "database",
		code: `const status = getQueryParam("status") || "active";
const limit = Number(getQueryParam("limit") || 20);

const rows = await dbQuery(
  "SELECT id, name, email, created_at FROM users WHERE status = $1 LIMIT $2",
  [status, limit]
);
return rows;`,
		tags: ["db", "database", "sql", "query"],
	},
	{
		id: "http-get",
		title: "HTTP GET Request",
		description: "Send an asynchronous GET request with headers",
		category: "http",
		code: `const apiKey = getConfig("API_KEY");
const res = await httpClient.get("https://api.example.com/v1/resource", {
  Authorization: \`Bearer \${apiKey}\`,
});
return res.data;`,
		tags: ["http", "get", "fetch", "api"],
	},
	{
		id: "http-post",
		title: "HTTP POST Request",
		description: "Send an asynchronous POST request with JSON payload",
		category: "http",
		code: `const res = await httpClient.post(
  "https://api.example.com/webhook",
  { event: "order_created", payload: input },
  { "Content-Type": "application/json" }
);
return res.data;`,
		tags: ["http", "post", "webhook", "api"],
	},
	{
		id: "pagination-offset-limit",
		title: "Pagination (Offset & Limit)",
		description: "Parse offset & per_page query params with safe defaults for DB blocks",
		category: "pagination",
		code: `const offset = Math.max(0, parseInt(getQueryParam("offset") || "0", 10));
const limit = Math.max(1, Math.min(100, parseInt(getQueryParam("per_page") || "10", 10)));
return { offset, limit };`,
		tags: ["pagination", "offset", "limit", "database", "query"],
	},
	{
		id: "pagination-page-perpage",
		title: "Pagination (Page & Per-Page)",
		description: "Convert page & per_page query params to calculated offset & limit",
		category: "pagination",
		code: `const page = Math.max(1, parseInt(getQueryParam("page") || "1", 10));
const perPage = Math.max(1, Math.min(100, parseInt(getQueryParam("per_page") || "10", 10)));
const offset = (page - 1) * perPage;
return { offset, limit: perPage };`,
		tags: ["pagination", "page", "per_page", "database"],
	},

	// 4. Authentication & Security
	{
		id: "jwt-verify",
		title: "JWT Verify Guard",
		description: "Verify Bearer token from header and return verified payload",
		category: "auth",
		code: `const authHeader = getHeader("authorization") || "";
const token = authHeader.replace(/^Bearer\\s+/i, "");
const secret = getConfig("JWT_SECRET") || "secret-key";

const { success, payload } = jwt.verify(token, secret);
if (!success || !payload) {
  throw new Error("Unauthorized: Invalid or expired token");
}
return { user: payload };`,
		tags: ["jwt", "verify", "auth", "bearer", "guard"],
	},
	{
		id: "jwt-sign",
		title: "JWT Sign (Issue Token)",
		description: "Sign a JWT token with payload, secret, and expiry",
		category: "auth",
		code: `const secret = getConfig("JWT_SECRET") || "secret-key";
const token = jwt.sign(
  { sub: input.id, role: input.role || "user" },
  secret,
  { expiresIn: "1d" }
);
return { token };`,
		tags: ["jwt", "sign", "auth", "token"],
	},

	// 5. Response Customization
	{
		id: "set-headers-custom",
		title: "Custom Response Headers",
		description: "Set outgoing response headers like Cache-Control",
		category: "response",
		code: `setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
setHeader("X-Request-Id", input.requestId || crypto.randomUUID());`,
		tags: ["header", "response", "cache"],
	},
	{
		id: "set-cookie-auth",
		title: "Set Secure Cookie",
		description: "Set an HTTP-only secure session cookie with options",
		category: "response",
		code: `setCookie("session_token", {
  value: input.token,
  httpOnly: true,
  secure: true,
  samesite: "Strict",
  path: "/",
  expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
});`,
		tags: ["cookie", "response", "auth", "session"],
	},

	// 6. Data Processing & Utilities
	{
		id: "dayjs-date-math",
		title: "Date Math & Formatting (Day.js)",
		description: "Manipulate and format dates using bundled Day.js",
		category: "utils",
		code: `const expiresAt = libs.dayjs().add(30, "day").toISOString();
const formattedDate = libs.dayjs().format("YYYY-MM-DD HH:mm:ss");
return { formattedDate, expiresAt };`,
		tags: ["date", "time", "dayjs", "libs"],
	},
	{
		id: "json-parse-safe",
		title: "Safe JSON Parse",
		description: "Safely parse JSON string with fallback default value",
		category: "utils",
		code: `function safeJsonParse(raw, fallback = {}) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}`,
		tags: ["json", "parse", "safe", "utils"],
	},
	{
		id: "underscore-group-by",
		title: "Group Array by Key (Underscore)",
		description: "Group collection items by field using bundled Underscore",
		category: "utils",
		code: `const items = Array.isArray(input) ? input : input?.items || [];
return libs._.groupBy(items, "category");`,
		tags: ["underscore", "array", "group", "libs"],
	},
	{
		id: "logger-structured-event",
		title: "Structured Event Log",
		description: "Write structured diagnostic entry with runtime metadata",
		category: "logging",
		code: `logger.logInfo({
  event: "action_executed",
  path: httpRequestRoute,
  method: httpRequestMethod,
  user: input?.userId,
  timestamp: new Date().toISOString(),
});`,
		tags: ["logger", "log", "logging", "telemetry"],
	},
];
