import { describe, expect, it } from "bun:test";
import {
	bodyReader,
	mediaType,
	RequestBodyError,
} from "../requestBody";
import { CONTENT_TYPES } from "../../../lib/routeConfig";

const MAX = 1024;

function request(method: string, body?: BodyInit, contentType?: string) {
	const headers = contentType ? { "content-type": contentType } : undefined;
	const raw = new Request("http://localhost/x", { method, body, headers });
	return {
		method,
		header: (name: string) => raw.headers.get(name) ?? undefined,
		raw,
	};
}

async function parse(
	req: ReturnType<typeof request>,
	accepted: readonly string[] = CONTENT_TYPES,
	maxBytes = MAX,
) {
	return await bodyReader(req, maxBytes)!.parse(accepted);
}

async function statusOf(promise: Promise<unknown>) {
	try {
		await promise;
		return 200;
	} catch (error) {
		if (error instanceof RequestBodyError) return error.status;
		throw error;
	}
}

describe("mediaType", () => {
	it("drops parameters and normalizes case", () => {
		expect(mediaType("Application/JSON; charset=utf-8")).toBe(
			"application/json",
		);
		expect(mediaType("multipart/form-data; boundary=--x")).toBe(
			"multipart/form-data",
		);
		expect(mediaType(undefined)).toBe("");
	});
});

describe("bodyReader", () => {
	it("is absent for methods that carry no body", () => {
		expect(bodyReader(request("GET"), MAX)).toBeUndefined();
		expect(bodyReader(request("DELETE"), MAX)).toBeUndefined();
	});

	it("is absent when the request declares no content type", () => {
		expect(bodyReader(request("POST", "x"), MAX)).toBeUndefined();
	});

	it("parses JSON even when the header carries a charset", async () => {
		const body = await parse(
			request("POST", '{"name":"Alice"}', "application/json; charset=utf-8"),
		);
		expect(body).toEqual({ name: "Alice" });
	});

	it("treats an empty JSON body as null instead of failing", async () => {
		expect(
			await parse(request("POST", "", "application/json")),
		).toBeNull();
	});

	it("rejects a content type the route does not accept", async () => {
		const status = await statusOf(
			parse(request("POST", "{}", "application/json"), [
				"multipart/form-data",
			]),
		);
		expect(status).toBe(415);
	});

	it("rejects a content type nothing supports", async () => {
		const status = await statusOf(
			parse(request("POST", "<a/>", "application/xml")),
		);
		expect(status).toBe(415);
	});

	it("turns urlencoded form data into a plain object", async () => {
		const body = await parse(
			request(
				"POST",
				"name=Alice&age=30",
				"application/x-www-form-urlencoded",
			),
		);
		expect(body).toEqual({ name: "Alice", age: "30" });
	});

	it("collects repeated form keys into an array", async () => {
		const body = (await parse(
			request("POST", "tag=a&tag=b&tag=c", "application/x-www-form-urlencoded"),
		)) as Record<string, unknown>;
		expect(body.tag).toEqual(["a", "b", "c"]);
	});

	it("keeps a __proto__ field as an own property", async () => {
		const body = (await parse(
			request(
				"POST",
				"__proto__=polluted&ok=1",
				"application/x-www-form-urlencoded",
			),
		)) as Record<string, unknown>;
		expect(Object.hasOwn(body, "__proto__")).toBe(true);
		expect(({} as any).polluted).toBeUndefined();
		expect(Object.getPrototypeOf(body)).toBe(Object.prototype);
	});

	it("returns multipart files as File instances beside plain fields", async () => {
		const form = new FormData();
		form.set("title", "avatar");
		form.set("upload", new File(["hello"], "a.txt", { type: "text/plain" }));
		const raw = new Request("http://localhost/x", { method: "POST", body: form });
		const body = (await bodyReader(
			{
				method: "POST",
				header: (name: string) => raw.headers.get(name) ?? undefined,
				raw,
			},
			MAX,
		)!.parse(CONTENT_TYPES)) as Record<string, unknown>;

		expect(body.title).toBe("avatar");
		expect(body.upload).toBeInstanceOf(File);
		expect(await (body.upload as File).text()).toBe("hello");
	});

	it("collects repeated multipart files into an array", async () => {
		const form = new FormData();
		form.append("docs", new File(["1"], "one.txt"));
		form.append("docs", new File(["2"], "two.txt"));
		const raw = new Request("http://localhost/x", { method: "POST", body: form });
		const body = (await bodyReader(
			{
				method: "POST",
				header: (name: string) => raw.headers.get(name) ?? undefined,
				raw,
			},
			MAX,
		)!.parse(CONTENT_TYPES)) as Record<string, unknown>;

		expect(Array.isArray(body.docs)).toBe(true);
		expect((body.docs as File[]).map((f) => f.name)).toEqual([
			"one.txt",
			"two.txt",
		]);
	});

	it("returns a raw binary body as a Blob", async () => {
		const body = await parse(
			request("POST", new Uint8Array([1, 2, 3]), "application/octet-stream"),
		);
		expect(body).toBeInstanceOf(Blob);
		expect((body as Blob).size).toBe(3);
	});

	it("returns text/plain untouched", async () => {
		expect(await parse(request("POST", "just words", "text/plain"))).toBe(
			"just words",
		);
	});

	it("reports malformed JSON as a 400, not a 500", async () => {
		const status = await statusOf(
			parse(request("POST", "{not json", "application/json")),
		);
		expect(status).toBe(400);
	});

	it("rejects a body whose declared length exceeds the cap", async () => {
		const status = await statusOf(
			parse(
				request("POST", "x".repeat(2048), "text/plain"),
				CONTENT_TYPES,
				MAX,
			),
		);
		expect(status).toBe(413);
	});

	it("rejects an oversized body that declared no length", async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("x".repeat(2048)));
				controller.close();
			},
		});
		const raw = new Request("http://localhost/x", {
			method: "POST",
			body: stream,
			headers: { "content-type": "text/plain" },
			// @ts-expect-error node/bun require this for a streaming body
			duplex: "half",
		});
		const status = await statusOf(
			bodyReader(
				{
					method: "POST",
					header: (name: string) => raw.headers.get(name) ?? undefined,
					raw,
				},
				MAX,
			)!.parse(CONTENT_TYPES),
		);
		expect(status).toBe(413);
	});

	it("parses only once, however often the body is read", async () => {
		const req = request("POST", '{"a":1}', "application/json");
		const reader = bodyReader(req, MAX)!;
		await reader.materialize();
		expect(await reader.parse(CONTENT_TYPES)).toEqual({ a: 1 });
	});
});
