import { describe, expect, it } from "bun:test";
import { parsePayload } from "./WorkflowRunModal";

describe("run payload", () => {
	it("sends JSON as JSON", () => {
		expect(parsePayload(' {"day": 1} ')).toEqual({ day: 1 });
	});

	it("sends anything else as the text that was typed", () => {
		// a workflow triggered by plain text has to be testable with plain text
		expect(parsePayload("hello there")).toBe("hello there");
	});

	it("sends nothing when nothing was typed", () => {
		expect(parsePayload("   ")).toBeUndefined();
	});
});
