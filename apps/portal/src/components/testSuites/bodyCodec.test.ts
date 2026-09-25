import { describe, expect, it } from "bun:test";
import { emptyRequestBody } from "@fluxify/components";
import { fromEditorBody, MAX_FILE_BYTES, toEditorBody } from "./bodyCodec";

const MULTIPART = "multipart/form-data";

describe("bodyCodec", () => {
	it("round-trips a multipart body with files through the stored shape", async () => {
		const stored = {
			note: "hi",
			docs: [
				{ name: "1.txt", type: "image/png", base64: btoa("one") },
				{ name: "2.txt", type: "image/png", base64: btoa("two") },
			],
		};
		const editor = toEditorBody(stored, MULTIPART);
		expect(editor.formRows.map((row) => row.key)).toEqual(["note", "docs", "docs"]);
		expect((editor.form.docs as File[]).map((f) => f.name)).toEqual(["1.txt", "2.txt"]);

		// hand-typed rows: repeated keys come back as an array
		expect(await fromEditorBody(editor, MULTIPART, false)).toEqual({ body: stored });
		// schema form: same stored shape
		expect(await fromEditorBody(editor, MULTIPART, true)).toEqual({ body: stored });
	});

	it("keeps JSON parsed, so data-driven cases can merge over it", async () => {
		expect(toEditorBody({ a: 1 }, "application/json").raw).toBe('{\n  "a": 1\n}');
		expect(await fromEditorBody(emptyRequestBody('{"a":1}'), "application/json", false)).toEqual({
			body: { a: 1 },
		});
		const bad = await fromEditorBody(emptyRequestBody("{"), "application/json", false);
		expect("error" in bad && bad.error).toStartWith("Invalid JSON");
	});

	it("stores octet-stream as base64, from a file or pasted text", async () => {
		const file = new File(["raw"], "a.bin");
		expect(
			await fromEditorBody({ ...emptyRequestBody(), binary: file }, "application/octet-stream", false),
		).toEqual({ body: btoa("raw") });
		expect(toEditorBody(btoa("raw"), "application/octet-stream").binary).toBe(btoa("raw"));
	});

	it("refuses a file over the cap instead of saving it", async () => {
		const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], "big.bin");
		const result = await fromEditorBody({ ...emptyRequestBody(), binary: big }, "application/octet-stream", false);
		expect(result).toEqual({ error: "big.bin is over 1MB" });
	});
});
