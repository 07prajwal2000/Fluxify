import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { verifyLicenseKey } from "../index";

/**
 * The `LICENSE_ISSUER_KEY_PATH` fallback, which only exists while no issuer key
 * is baked into the build. Its own file because the resolved key is memoized
 * once per module registry — a sibling test that verified with an explicit key
 * would have already cached "no issuer key" here.
 */

const issuer = generateKeyPairSync("ed25519");
const dir = mkdtempSync(join(tmpdir(), "fluxify-license-"));
const publicKeyPath = join(dir, "issuer.pub");
writeFileSync(publicKeyPath, issuer.publicKey.export({ type: "spki", format: "pem" }) as string);

/** The same token shape `scripts/mint.ts` writes. */
function token(claims: Record<string, unknown>) {
	const segment = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const body = `${segment({ alg: "EdDSA", typ: "JWT" })}.${segment(claims)}`;
	return `${body}.${sign(null, Buffer.from(body), issuer.privateKey).toString("base64url")}`;
}

afterEach(() => {
	delete process.env.LICENSE_ISSUER_KEY_PATH;
});

describe("LICENSE_ISSUER_KEY_PATH", () => {
	it("verifies a locally minted key", () => {
		process.env.LICENSE_ISSUER_KEY_PATH = publicKeyPath;
		expect(verifyLicenseKey(token({ sub: "acme", features: ["*"] }))).toEqual({
			kind: "signed",
			licensee: "acme",
			expiresAt: null,
			features: ["*"],
		});
	});

	it("refuses a signed key when the path is unset", () => {
		// memoized from the first test, so prove the negative in a fresh process
		expect(() => verifyLicenseKey(token({ sub: "acme", features: ["*"] }), null)).toThrow(
			"this build cannot verify license keys yet",
		);
	});
});
