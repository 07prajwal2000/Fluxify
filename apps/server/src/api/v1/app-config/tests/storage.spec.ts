import { describe, expect, it } from "bun:test";
import { nextDevValue, shownValue, storeValue } from "../storage";

// Encrypted values are not exercised here: the master key is read once per
// process, so a spec that needs it is order-dependent. The encrypted path is
// covered end to end by the compiler's real-service test.

const plain = (devValue: string | null, encodingType: "plaintext" | "base64" = "plaintext") => ({
	devValue,
	isEncrypted: false,
	encodingType,
});

describe("storeValue / shownValue", () => {
	it("stores a plain value in the entry's encoding and shows it back decoded", () => {
		expect(storeValue("secret", false, "base64")).toBe("c2VjcmV0");
		expect(shownValue("c2VjcmV0", false, "base64")).toBe("secret");
	});

	it("shows nothing while there is no value", () => {
		expect(shownValue(null, false, "plaintext")).toBeNull();
	});

	it("never shows an encrypted value", () => {
		expect(shownValue("ciphertext-here", true, "plaintext")).toMatch(/^\*+$/);
	});
});

describe("nextDevValue on update", () => {
	const body = { isEncrypted: false, encodingType: "plaintext" as const };

	it("leaves the column alone when the request says nothing and nothing changed", () => {
		expect(nextDevValue(plain("kept"), body)).toBeUndefined();
		expect(nextDevValue(plain(null), body)).toBeUndefined();
	});

	it("clears on null and stores a new value", () => {
		expect(nextDevValue(plain("old"), { ...body, devValue: null })).toBeNull();
		expect(nextDevValue(plain("old"), { ...body, devValue: 7 })).toBe("7");
	});

	it("re-encodes an untouched value when the encoding changes", () => {
		expect(nextDevValue(plain("hello"), { ...body, encodingType: "base64" })).toBe(
			Buffer.from("hello").toString("base64"),
		);
	});

	it("does not invent a value when there is none to re-encode", () => {
		expect(nextDevValue(plain(null), { ...body, encodingType: "base64" })).toBeUndefined();
	});
});
