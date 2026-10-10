import { describe, expect, it } from "bun:test";
import { generateDevToken, hashDevToken, verifyDevToken } from "./devToken";

describe("generateDevToken", () => {
	it("is fxd_ plus 32 random bytes, base64url", () => {
		expect(generateDevToken()).toMatch(/^fxd_[A-Za-z0-9_-]{43}$/);
	});

	it("never repeats", () => {
		expect(generateDevToken()).not.toBe(generateDevToken());
	});
});

describe("hashDevToken", () => {
	it("is the hex sha256 of the token", () => {
		expect(hashDevToken("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});

describe("verifyDevToken", () => {
	const oldToken = generateDevToken();
	const newToken = generateDevToken();
	const dev = { devTokenHash: hashDevToken(newToken) };

	it("accepts the token the config was built from", () => {
		expect(verifyDevToken(dev, newToken)).toBe(true);
	});

	it("refuses a rotated-away token", () => {
		expect(verifyDevToken(dev, oldToken)).toBe(false);
	});

	it("refuses everything on a production config, which has no hash", () => {
		expect(verifyDevToken({}, newToken)).toBe(false);
		expect(verifyDevToken({ devTokenHash: "" }, newToken)).toBe(false);
		expect(verifyDevToken(undefined, newToken)).toBe(false);
	});

	it("refuses a missing or empty header", () => {
		expect(verifyDevToken(dev, undefined)).toBe(false);
		expect(verifyDevToken(dev, null)).toBe(false);
		expect(verifyDevToken(dev, "")).toBe(false);
	});

	it("refuses a hash that is not sha256 instead of throwing", () => {
		expect(verifyDevToken({ devTokenHash: "zz" }, newToken)).toBe(false);
		expect(verifyDevToken({ devTokenHash: "abcd" }, newToken)).toBe(false);
	});
});
