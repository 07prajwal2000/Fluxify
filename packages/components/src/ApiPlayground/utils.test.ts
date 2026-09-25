import { describe, expect, it } from "bun:test";
import {
	emptyRequestBody,
	formatResponseBody,
	resolvePathRows,
	resolveQueryRows,
	serializeFormBody,
	serializeRequestBody,
} from "./utils";

describe("formatResponseBody", () => {
	it("pretty-prints valid application/json responses", () => {
		expect(formatResponseBody('{"status":"ok","items":[1,2]}', "application/json; charset=utf-8")).toBe(`{
  "status": "ok",
  "items": [
    1,
    2
  ]
}`);
	});

	it("preserves non-JSON and malformed JSON bodies", () => {
		expect(formatResponseBody('{"status":"ok"}', "text/plain")).toBe('{"status":"ok"}');
		expect(formatResponseBody('{invalid', "application/json")).toBe("{invalid");
	});
});

describe("resolvePathRows", () => {
	it("initializes from path parameters with default empty values", () => {
		const rows = resolvePathRows("/users/:id/posts/:slug");
		expect(rows).toHaveLength(2);
		expect(rows[0]?.key).toBe("id");
		expect(rows[0]?.value).toBe("");
		expect(rows[1]?.key).toBe("slug");
		expect(rows[1]?.value).toBe("");
	});

	it("restores cached values for matching path parameters", () => {
		const cached = [
			{ id: "1", key: "id", value: "42" },
			{ id: "2", key: "oldParam", value: "legacy" },
		];
		const rows = resolvePathRows("/users/:id/posts/:slug", { slug: "my-post" }, cached);
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.key === "id")?.value).toBe("42");
		expect(rows.find((r) => r.key === "slug")?.value).toBe("my-post");
	});
});

describe("resolveQueryRows", () => {
	const schema = {
		properties: {
			page: { type: "number", required: true },
			limit: { type: "number", required: false },
		},
	};

	it("initializes from schema properties when no cache provided", () => {
		const rows = resolveQueryRows(schema, { page: "1" });
		expect(rows).toHaveLength(2);
		expect(rows.find((r) => r.key === "page")?.value).toBe("1");
		expect(rows.find((r) => r.key === "limit")?.value).toBe("");
	});

	it("preserves cached schema values and custom query rows", () => {
		const cached = [
			{ id: "1", key: "page", value: "5", required: true },
			{ id: "2", key: "customFilter", value: "active" },
		];
		const rows = resolveQueryRows(schema, undefined, cached);
		expect(rows).toHaveLength(3);
		expect(rows.find((r) => r.key === "page")?.value).toBe("5");
		expect(rows.find((r) => r.key === "limit")?.value).toBe("");
		expect(rows.find((r) => r.key === "customFilter")?.value).toBe("active");
	});
});

describe("serializeFormBody", () => {
	it("sends each file of a multi-file field under the same key", () => {
		const a = new File(["a"], "a.txt");
		const b = new File(["b"], "b.txt");
		const form = serializeFormBody({ docs: [a, b], note: "hi", empty: "" }, "multipart/form-data");
		expect(form).toBeInstanceOf(FormData);
		expect((form as FormData).getAll("docs").map((f) => (f as File).name)).toEqual(["a.txt", "b.txt"]);
		expect((form as FormData).get("note")).toBe("hi");
		expect((form as FormData).has("empty")).toBe(false);
	});
});

describe("serializeRequestBody", () => {
	it("sends hand-typed rows when the schema declares no fields, repeating keys", () => {
		const a = new File(["a"], "a.txt");
		const body = {
			...emptyRequestBody(),
			formRows: [
				{ id: "1", key: "docs", value: a, isFile: true },
				{ id: "2", key: "docs", value: "b" },
				{ id: "3", key: "", value: "dropped" },
			],
		};
		const form = serializeRequestBody(body, "multipart/form-data", null) as FormData;
		expect(form.getAll("docs")).toHaveLength(2);
		expect(serializeRequestBody(body, "application/x-www-form-urlencoded", null)).toBe("docs=b");
	});

	it("decodes base64 for octet-stream, and passes a picked file through", async () => {
		const blob = serializeRequestBody({ ...emptyRequestBody(), binary: btoa("hi") }, "application/octet-stream");
		expect(await (blob as Blob).text()).toBe("hi");
		const file = new File(["x"], "x.bin");
		expect(serializeRequestBody({ ...emptyRequestBody(), binary: file }, "application/octet-stream")).toBe(file);
		expect(serializeRequestBody(emptyRequestBody(), "application/octet-stream")).toBeUndefined();
	});

	it("sends raw text for JSON", () => {
		expect(serializeRequestBody(emptyRequestBody('{"a":1}'), "application/json")).toBe('{"a":1}');
	});
});
