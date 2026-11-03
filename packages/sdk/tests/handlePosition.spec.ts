import { describe, expect, it } from "bun:test";
import { block, handle, toManifestEntry } from "../blocks.js";

const run = () => ({ output: 1 });

describe("handle position", () => {
	it("any handle can sit on any side or corner; the manifest records only the moved ones", () => {
		const handles = {
			in: [handle.in("target", { position: "top" }), handle.in("other")],
			out: [handle.out("success", { position: "bottom-right" }), handle.out("failure")],
			body: [handle.body("side", "right")],
		} as const;
		const entry = toManifestEntry(block({ name: "acme/x/free", label: "Free", handles, invoke: ["sync"], run }));
		expect(entry.handles).toEqual({
			in: ["target", "other"],
			out: ["success", "failure"],
			body: [{ name: "side", corner: "right" }],
			position: { target: "top", success: "bottom-right" },
		});
	});

	it("leaves `position` out of the manifest when nothing moved", () => {
		const entry = toManifestEntry(block({ name: "acme/x/plain", label: "Plain", run }));
		expect(entry.handles).not.toHaveProperty("position");
	});

	it("refuses a position that is not a side or corner", () => {
		const handles = { out: [handle.out("source", { position: "centre" as never })] } as const;
		expect(() => block({ name: "acme/x/bad", label: "Bad", handles, run })).toThrow();
	});
});
