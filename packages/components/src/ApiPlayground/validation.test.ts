import { describe, expect, it } from "bun:test";
import type { ApiKeyValue, ApiPlaygroundRoute } from "./types";
import { getMissingPathParams, validatePlaygroundRequest, validatePropertyValue } from "./validation";

describe("getMissingPathParams", () => {
	it("identifies missing path parameters when rows are empty or missing", () => {
		const path = "/orgs/:orgId/users/:userId";
		const rows: ApiKeyValue[] = [
			{ id: "1", key: "orgId", value: "" },
		];
		expect(getMissingPathParams(path, rows)).toEqual(["orgId", "userId"]);
	});

	it("identifies whitespace-only path parameters as missing", () => {
		const path = "/users/:id";
		const rows: ApiKeyValue[] = [
			{ id: "1", key: "id", value: "   " },
		];
		expect(getMissingPathParams(path, rows)).toEqual(["id"]);
	});

	it("returns empty array when all path parameters have values", () => {
		const path = "/orgs/:orgId/users/:userId";
		const rows: ApiKeyValue[] = [
			{ id: "1", key: "orgId", value: "org-123" },
			{ id: "2", key: "userId", value: "usr-456" },
		];
		expect(getMissingPathParams(path, rows)).toEqual([]);
	});
});

describe("validatePropertyValue", () => {
	it("validates int / integer types", () => {
		expect(validatePropertyValue("123", { key: "age", dataType: "int" }, { coerce: true })).toBeNull();
		expect(validatePropertyValue("-5", { key: "age", dataType: "int" }, { coerce: true })).toBeNull();
		expect(validatePropertyValue("12.34", { key: "age", dataType: "int" }, { coerce: true })).toBe("Must be an integer");
		expect(validatePropertyValue("abc", { key: "age", dataType: "int" }, { coerce: true })).toBe("Must be an integer");
	});

	it("validates float / number types", () => {
		expect(validatePropertyValue("12.34", { key: "price", dataType: "float" }, { coerce: true })).toBeNull();
		expect(validatePropertyValue("abc", { key: "price", dataType: "float" }, { coerce: true })).toBe("Must be a number");
	});

	it("validates bool / boolean types", () => {
		expect(validatePropertyValue("true", { key: "active", dataType: "bool" }, { coerce: true })).toBeNull();
		expect(validatePropertyValue("false", { key: "active", dataType: "bool" }, { coerce: true })).toBeNull();
		expect(validatePropertyValue("1", { key: "active", dataType: "bool" }, { coerce: true })).toBeNull();
		expect(validatePropertyValue("not_a_bool", { key: "active", dataType: "bool" }, { coerce: true })).toBe("Must be a boolean (true or false)");
	});

	it("validates enum types", () => {
		const prop = {
			key: "status",
			dataType: "enum",
			rules: [{ type: "values", value: ["active", "pending", "archived"] }],
		};
		expect(validatePropertyValue("active", prop)).toBeNull();
		expect(validatePropertyValue("invalid_status", prop)).toBe("Must be one of: active, pending, archived");
	});

	it("validates string rules: minLength, maxLength, regex, startsWith, endsWith, contains", () => {
		const minProp = { key: "s", dataType: "str", rules: [{ type: "minLength", value: 3 }] };
		expect(validatePropertyValue("hi", minProp)).toBe("Must be at least 3 characters");
		expect(validatePropertyValue("hello", minProp)).toBeNull();

		const maxProp = { key: "s", dataType: "str", rules: [{ type: "maxLength", value: 4 }] };
		expect(validatePropertyValue("hello", maxProp)).toBe("Must be at most 4 characters");
		expect(validatePropertyValue("hey", maxProp)).toBeNull();

		const regexProp = { key: "s", dataType: "str", rules: [{ type: "regex", value: "^[A-Z]+$" }] };
		expect(validatePropertyValue("abc", regexProp)).toBe("Must match pattern ^[A-Z]+$");
		expect(validatePropertyValue("ABC", regexProp)).toBeNull();

		const startsProp = { key: "s", dataType: "str", rules: [{ type: "startsWith", value: "foo" }] };
		expect(validatePropertyValue("barfoo", startsProp)).toBe('Must start with "foo"');
		expect(validatePropertyValue("foobar", startsProp)).toBeNull();
	});

	it("validates numeric rules: min, max", () => {
		const numProp = { key: "n", dataType: "int", rules: [{ type: "min", value: 5 }, { type: "max", value: 10 }] };
		expect(validatePropertyValue(3, numProp)).toBe("Must be at least 5");
		expect(validatePropertyValue(15, numProp)).toBe("Must be at most 10");
		expect(validatePropertyValue(7, numProp)).toBeNull();
	});
});

describe("validatePlaygroundRequest", () => {
	const baseRoute: ApiPlaygroundRoute = {
		method: "POST",
		path: "/items/:itemId",
	};

	it("blocks requests with missing required route params", () => {
		const result = validatePlaygroundRequest({
			route: baseRoute,
			rawPath: "/items/:itemId",
			pathRows: [{ id: "1", key: "itemId", value: "" }],
			queryRows: [],
			contentType: "application/json",
			body: "{}",
			formBody: {},
		});

		expect(result.isValid).toBe(false);
		expect(result.firstErrorTab).toBe("params");
		expect(result.toastMessage).toBe("Missing required route parameter: :itemId");
		expect(result.errors.pathParams.itemId).toBe("Route parameter is required");
	});

	it("validates route params against paramsSchema data type and rules", () => {
		const route: ApiPlaygroundRoute = {
			...baseRoute,
			paramsSchema: {
				properties: [
					{
						key: "itemId",
						dataType: "int",
						required: true,
						rules: [{ type: "min", value: 1 }],
					},
				],
			},
		};

		// Non-integer string
		const nonInt = validatePlaygroundRequest({
			route,
			rawPath: "/items/:itemId",
			pathRows: [{ id: "1", key: "itemId", value: "abc" }],
			queryRows: [],
			contentType: "application/json",
			body: "{}",
			formBody: {},
		});
		expect(nonInt.isValid).toBe(false);
		expect(nonInt.errors.pathParams.itemId).toBe("Must be an integer");
		expect(nonInt.toastMessage).toContain("itemId: Must be an integer");

		// Below min
		const belowMin = validatePlaygroundRequest({
			route,
			rawPath: "/items/:itemId",
			pathRows: [{ id: "1", key: "itemId", value: "0" }],
			queryRows: [],
			contentType: "application/json",
			body: "{}",
			formBody: {},
		});
		expect(belowMin.isValid).toBe(false);
		expect(belowMin.errors.pathParams.itemId).toBe("Must be at least 1");

		// Valid
		const valid = validatePlaygroundRequest({
			route,
			rawPath: "/items/:itemId",
			pathRows: [{ id: "1", key: "itemId", value: "42" }],
			queryRows: [],
			contentType: "application/json",
			body: "{}",
			formBody: {},
		});
		expect(valid.isValid).toBe(true);
	});

	it("blocks requests with missing required query params and validates query types", () => {
		const route: ApiPlaygroundRoute = {
			...baseRoute,
			path: "/items",
			querySchema: {
				properties: [{ key: "limit", dataType: "int", required: true, rules: [{ type: "max", value: 100 }] }],
			},
		};

		const missing = validatePlaygroundRequest({
			route,
			rawPath: "/items",
			pathRows: [],
			queryRows: [{ id: "1", key: "limit", value: "", required: true }],
			contentType: "application/json",
			body: "{}",
			formBody: {},
		});
		expect(missing.isValid).toBe(false);
		expect(missing.errors.queryParams.limit).toBe("Field is required");

		const overMax = validatePlaygroundRequest({
			route,
			rawPath: "/items",
			pathRows: [],
			queryRows: [{ id: "1", key: "limit", value: "150", required: true }],
			contentType: "application/json",
			body: "{}",
			formBody: {},
		});
		expect(overMax.isValid).toBe(false);
		expect(overMax.errors.queryParams.limit).toBe("Must be at most 100");
	});

	it("blocks requests with missing required form fields and validates types", () => {
		const route: ApiPlaygroundRoute = {
			...baseRoute,
			path: "/items",
			bodySchema: {
				properties: [
					{ key: "count", required: true, dataType: "int" },
					{ key: "notes", required: false, dataType: "str" },
				],
			},
		};

		const result = validatePlaygroundRequest({
			route,
			rawPath: "/items",
			pathRows: [],
			queryRows: [],
			contentType: "multipart/form-data",
			body: "",
			formBody: { count: "not_a_number" },
		});

		expect(result.isValid).toBe(false);
		expect(result.firstErrorTab).toBe("body");
		expect(result.errors.formFields.count).toBe("Must be an integer");
	});

	it("blocks requests with invalid JSON syntax", () => {
		const route: ApiPlaygroundRoute = {
			...baseRoute,
			path: "/items",
			bodySchema: {
				properties: [{ key: "title", required: true }],
			},
		};

		const result = validatePlaygroundRequest({
			route,
			rawPath: "/items",
			pathRows: [],
			queryRows: [],
			contentType: "application/json",
			body: "{ invalid json",
			formBody: {},
		});

		expect(result.isValid).toBe(false);
		expect(result.firstErrorTab).toBe("body");
		expect(result.toastMessage).toContain("Invalid JSON");
		expect(result.errors.bodyError).toContain("Invalid JSON");
	});

	it("validates data types and rules in JSON body payload", () => {
		const route: ApiPlaygroundRoute = {
			...baseRoute,
			path: "/items",
			bodySchema: {
				properties: [
					{ key: "age", dataType: "int", required: true, rules: [{ type: "min", value: 18 }] },
					{ key: "role", dataType: "enum", required: true, rules: [{ type: "values", value: ["admin", "member"] }] },
				],
			},
		};

		// Missing age
		const missingAge = validatePlaygroundRequest({
			route,
			rawPath: "/items",
			pathRows: [],
			queryRows: [],
			contentType: "application/json",
			body: JSON.stringify({ role: "admin" }),
			formBody: {},
		});
		expect(missingAge.isValid).toBe(false);
		expect(missingAge.errors.bodyError).toContain("age: Field is required");

		// Age below min and invalid role
		const invalidAgeAndRole = validatePlaygroundRequest({
			route,
			rawPath: "/items",
			pathRows: [],
			queryRows: [],
			contentType: "application/json",
			body: JSON.stringify({ age: 12, role: "superuser" }),
			formBody: {},
		});
		expect(invalidAgeAndRole.isValid).toBe(false);
		expect(invalidAgeAndRole.errors.bodyError).toContain("age: Must be at least 18");
		expect(invalidAgeAndRole.errors.bodyError).toContain("role: Must be one of: admin, member");

		// Valid JSON body
		const valid = validatePlaygroundRequest({
			route,
			rawPath: "/items",
			pathRows: [],
			queryRows: [],
			contentType: "application/json",
			body: JSON.stringify({ age: 25, role: "member" }),
			formBody: {},
		});
		expect(valid.isValid).toBe(true);
	});

	it("validates binary / octet-stream size limits", () => {
		const route: ApiPlaygroundRoute = {
			...baseRoute,
			path: "/upload",
			bodySchema: {
				dataType: "blob",
				rules: [
					{ type: "minSize", value: 5 },
					{ type: "maxSize", value: 10 },
				],
			} as any,
		};

		// Too short
		const tooShort = validatePlaygroundRequest({
			route,
			rawPath: "/upload",
			pathRows: [],
			queryRows: [],
			contentType: "application/octet-stream",
			body: "hi",
			formBody: {},
		});
		expect(tooShort.isValid).toBe(false);
		expect(tooShort.toastMessage).toContain("below minimum of 5 bytes");

		// Too large
		const tooLarge = validatePlaygroundRequest({
			route,
			rawPath: "/upload",
			pathRows: [],
			queryRows: [],
			contentType: "application/octet-stream",
			body: "this is much too long",
			formBody: {},
		});
		expect(tooLarge.isValid).toBe(false);
		expect(tooLarge.toastMessage).toContain("exceeds maximum of 10 bytes");

		// Valid size
		const valid = validatePlaygroundRequest({
			route,
			rawPath: "/upload",
			pathRows: [],
			queryRows: [],
			contentType: "application/octet-stream",
			body: "1234567",
			formBody: {},
		});
		expect(valid.isValid).toBe(true);
	});

	it("passes valid requests without errors", () => {
		const result = validatePlaygroundRequest({
			route: baseRoute,
			rawPath: "/items/:itemId",
			pathRows: [{ id: "1", key: "itemId", value: "item-42" }],
			queryRows: [{ id: "2", key: "q", value: "search", required: true }],
			contentType: "application/json",
			body: "{}",
			formBody: {},
		});

		expect(result.isValid).toBe(true);
		expect(result.toastMessage).toBeUndefined();
		expect(Object.keys(result.errors.pathParams)).toHaveLength(0);
	});
});
