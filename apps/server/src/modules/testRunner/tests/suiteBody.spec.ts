import { describe, expect, test } from "bun:test";
import { testSuiteCoreSchema } from "../../../api/v1/test-suites/schema";
import { contentTypeOf, decodeSuiteBody } from "../suiteBody";

const b64 = (text: string) => Buffer.from(text).toString("base64");

describe("decodeSuiteBody", () => {
	test("multipart files become File, arrays of files stay arrays, text stays text", async () => {
		const body = decodeSuiteBody(
			{
				note: "hi",
				avatar: { name: "a.png", type: "image/png", base64: b64("png") },
				docs: [
					{ name: "1.txt", type: "text/plain", base64: b64("one") },
					{ name: "2.txt", type: "text/plain", base64: b64("two") },
				],
			},
			"multipart/form-data",
		) as Record<string, any>;

		expect(body.note).toBe("hi");
		expect(body.avatar).toBeInstanceOf(File);
		expect(body.avatar.name).toBe("a.png");
		expect(await body.avatar.text()).toBe("png");
		expect(body.docs.map((f: File) => f.name)).toEqual(["1.txt", "2.txt"]);
	});

	test("octet-stream base64 becomes a Blob of the decoded bytes", async () => {
		const blob = decodeSuiteBody(b64("raw bytes"), "application/octet-stream") as Blob;
		expect(blob).toBeInstanceOf(Blob);
		expect(await blob.text()).toBe("raw bytes");
	});

	test("JSON and urlencoded bodies pass through untouched", () => {
		const json = { a: { name: "x", base64: "y" } };
		expect(decodeSuiteBody(json, "application/json")).toBe(json);
		expect(decodeSuiteBody({ a: "1" }, "application/x-www-form-urlencoded")).toEqual({ a: "1" });
	});

	test("content type is read from headers in any casing, parameters dropped", () => {
		expect(contentTypeOf({ "content-type": "multipart/form-data; boundary=x" })).toBe(
			"multipart/form-data",
		);
		expect(contentTypeOf({})).toBe("");
	});
});

test("a stored body over the cap is rejected, so a big file can't bloat the row", () => {
	const body = testSuiteCoreSchema.shape.body;
	expect(body.safeParse({ f: { name: "a", type: "", base64: "x".repeat(1_000) } }).success).toBe(true);
	expect(body.safeParse("x".repeat(2_000_000)).success).toBe(false);
});
