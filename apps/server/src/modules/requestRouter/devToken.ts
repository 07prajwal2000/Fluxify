import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ProjectConfigPayload } from "../compiler/artifacts";

/** The header a caller sends to reach `/_/dev/*` and `/_sandbox/*` (#734). */
export const DEV_TOKEN_HEADER = "x-fluxify-dev-token";

export function generateDevToken() {
	return `fxd_${randomBytes(32).toString("base64url")}`;
}

/** Only this travels in the development config; the token itself never does. */
export function hashDevToken(token: string) {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * Does `header` carry this project's dev token? A production config has no
 * hash, so it always refuses. Sandboxes (#735) call it; dev routes (#736) will.
 */
export function verifyDevToken(
	payload: Pick<ProjectConfigPayload, "devTokenHash"> | null | undefined,
	header: string | null | undefined,
): boolean {
	const expected = payload?.devTokenHash;
	if (!expected || !header) return false;
	const want = Buffer.from(expected, "hex");
	const got = Buffer.from(hashDevToken(header), "hex");
	return want.length === got.length && timingSafeEqual(want, got);
}
