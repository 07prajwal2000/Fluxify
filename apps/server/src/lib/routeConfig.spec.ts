import { describe, expect, test } from "bun:test";
import { bodyModeOf, sseBrokerOf } from "./routeConfig";

describe("sseBrokerOf", () => {
	test("reads the stored broker id; unset is undefined", () => {
		expect(sseBrokerOf({ sseBrokerId: "int_1" })).toBe("int_1");
		expect(sseBrokerOf({})).toBeUndefined();
		expect(sseBrokerOf(undefined)).toBeUndefined();
	});

	test("a malformed value reads as unset without dropping the other settings", () => {
		const stored = { sseBrokerId: 42, bodyMode: "stream", acceptedContentTypes: ["application/octet-stream"] };
		expect(sseBrokerOf(stored)).toBeUndefined();
		expect(bodyModeOf(stored)).toBe("stream");
	});
});
