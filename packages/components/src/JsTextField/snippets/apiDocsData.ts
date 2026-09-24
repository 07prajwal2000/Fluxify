import { REQUEST_RESPONSE_DOCS } from "./apiDocsRequest";
import { TRIGGER_DOCS } from "./apiDocsTrigger";
import type { ApiDocCategoryGroup, ApiDocItem, SnippetCategory } from "./types";

export type { ApiDocCategoryGroup, ApiDocItem, SnippetCategory };

export const API_DOCS: ApiDocItem[] = [
	...REQUEST_RESPONSE_DOCS,
	...TRIGGER_DOCS,

	// JWT
	{
		id: "api-jwt-sign",
		name: "jwt.sign",
		kind: "function",
		signature: "jwt.sign(payload: object, secretKey: string, options?: object): string",
		description: "Signs and returns a JWT token with claims, secret, and options.",
		category: "auth",
		example:
			'const token = jwt.sign({ sub: input.id }, getConfig("JWT_SECRET") || "secret", { expiresIn: "1d" });',
		returns: "string",
	},
	{
		id: "api-jwt-verify",
		name: "jwt.verify",
		kind: "function",
		signature:
			"jwt.verify(token: string, secretKey: string, options?: object): { success: boolean; payload: any }",
		description: "Verifies a JWT token. Invalid tokens return { success: false } without throwing.",
		category: "auth",
		example: 'const { success, payload } = jwt.verify(token, getConfig("JWT_SECRET") || "secret");',
		returns: "{ success: boolean; payload: Record<string, string> | null }",
	},
	{
		id: "api-jwt-decode",
		name: "jwt.decode",
		kind: "function",
		signature: "jwt.decode(token: string, options?: object): Record<string, string> | null",
		description: "Decodes a JWT token without verifying signature.",
		category: "auth",
		example: "const payload = jwt.decode(token);",
		returns: "Record<string, string> | null",
	},

	// HTTP client
	{
		id: "api-http-get",
		name: "httpClient.get",
		kind: "function",
		signature:
			"httpClient.get<T = any>(url: string, headers?: Record<string, string>): Promise<AxiosResponse<T>>",
		description: "Sends an asynchronous HTTP GET request.",
		category: "http",
		example: 'const res = await httpClient.get("https://api.example.com/items");\nreturn res.data;',
		returns: "Promise<AxiosResponse<T>>",
	},
	{
		id: "api-http-post",
		name: "httpClient.post",
		kind: "function",
		signature:
			"httpClient.post<T = any>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>",
		description: "Sends an asynchronous HTTP POST request with JSON payload.",
		category: "http",
		example:
			'const res = await httpClient.post("https://api.example.com/items", { name: "New Item" });\nreturn res.data;',
		returns: "Promise<AxiosResponse<T>>",
	},
	{
		id: "api-http-put",
		name: "httpClient.put",
		kind: "function",
		signature:
			"httpClient.put<T = any>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>",
		description: "Sends an asynchronous HTTP PUT request.",
		category: "http",
		example:
			'const res = await httpClient.put("https://api.example.com/items/1", { name: "Updated" });',
		returns: "Promise<AxiosResponse<T>>",
	},
	{
		id: "api-http-delete",
		name: "httpClient.delete",
		kind: "function",
		signature:
			"httpClient.delete<T = any>(url: string, headers?: Record<string, string>): Promise<AxiosResponse<T>>",
		description: "Sends an asynchronous HTTP DELETE request.",
		category: "http",
		example: 'await httpClient.delete("https://api.example.com/items/1");',
		returns: "Promise<AxiosResponse<T>>",
	},
	{
		id: "api-http-patch",
		name: "httpClient.patch",
		kind: "function",
		signature:
			"httpClient.patch<T = any>(url: string, data?: any, headers?: Record<string, string>): Promise<AxiosResponse<T>>",
		description: "Sends an asynchronous HTTP PATCH request.",
		category: "http",
		example:
			'const res = await httpClient.patch("https://api.example.com/items/1", { active: true });',
		returns: "Promise<AxiosResponse<T>>",
	},

	// Logging
	{
		id: "api-logger-logInfo",
		name: "logger.logInfo",
		kind: "function",
		signature: "logger.logInfo(value: any): void",
		description: "Writes an informational diagnostic log entry.",
		category: "logging",
		example: 'logger.logInfo({ event: "order_created", id: input.id });',
		returns: "void",
	},
	{
		id: "api-logger-logWarn",
		name: "logger.logWarn",
		kind: "function",
		signature: "logger.logWarn(value: any): void",
		description: "Writes a warning log entry.",
		category: "logging",
		example: 'logger.logWarn("Rate limit approaching");',
		returns: "void",
	},
	{
		id: "api-logger-logError",
		name: "logger.logError",
		kind: "function",
		signature: "logger.logError(value: any): void",
		description: "Writes an error log entry with diagnostic metadata.",
		category: "logging",
		example: "logger.logError({ error: err.message });",
		returns: "void",
	},

	// Saved outputs
	{
		id: "api-outputs",
		name: "outputs",
		kind: "object",
		signature: "outputs: Record<string, any>",
		description:
			'Outputs of blocks with "Save output to variable" on, by name. Reset on every request.',
		category: "variables",
		example: "return outputs.users.filter((user) => user.active);",
		returns: "Record<string, any>",
	},

	// Database
	{
		id: "api-dbQuery",
		name: "dbQuery",
		kind: "function",
		signature: "dbQuery(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>",
		description:
			"Executes parameterized SQL query with $1, $2 placeholders (PostgreSQL) or ? (MySQL).",
		category: "database",
		example:
			'const rows = await dbQuery("SELECT * FROM users WHERE id = $1", [input.id]);\nreturn rows;',
		returns: "Promise<Record<string, unknown>[]>",
	},

	// Libraries
	{
		id: "api-import",
		name: "import",
		kind: "lib",
		signature: 'import x from "<package>"',
		description:
			"Import any npm package installed in the project (Project Settings > npm Packages), or a Bun built-in module.",
		category: "utils",
		example: 'import dayjs from "dayjs";\nreturn dayjs().add(7, "day").toISOString();',
		returns: "module",
	},
];

export const API_DOC_CATEGORIES: { category: SnippetCategory; title: string }[] = [
	{ category: "request", title: "Request Values" },
	{ category: "params", title: "Parameters" },
	{ category: "response", title: "Response Helpers" },
	{ category: "config", title: "Configuration" },
	{ category: "variables", title: "Context & Variables" },
	{ category: "auth", title: "Authentication (JWT)" },
	{ category: "http", title: "HTTP Client" },
	{ category: "logging", title: "Logging" },
	{ category: "database", title: "Database" },
	{ category: "utils", title: "Date & Utilities" },
	{ category: "validation", title: "Validation (Zod)" },
];

export function getGroupedApiDocs(): ApiDocCategoryGroup[] {
	const groups: ApiDocCategoryGroup[] = [];
	for (const { category, title } of API_DOC_CATEGORIES) {
		const items = API_DOCS.filter((doc) => doc.category === category);
		if (items.length > 0) {
			groups.push({ category, title, items });
		}
	}
	return groups;
}
