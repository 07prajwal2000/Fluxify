/**
 * UUID v7 (RFC 9562): 48-bit big-endian timestamp + random, so ids sort by
 * creation time. The save endpoint validates every block/edge id as v7, which
 * rules out `crypto.randomUUID()` (v4) and React Flow's default `xy-edge__…`.
 */
export function uuidv7(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	const timestamp = Date.now();

	// unix_ts_ms, most significant byte first.
	bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
	bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
	bytes[2] = Math.floor(timestamp / 2 ** 24) & 0xff;
	bytes[3] = Math.floor(timestamp / 2 ** 16) & 0xff;
	bytes[4] = Math.floor(timestamp / 2 ** 8) & 0xff;
	bytes[5] = timestamp & 0xff;

	bytes[6] = 0x70 | (bytes[6] & 0x0f); // version 7
	bytes[8] = 0x80 | (bytes[8] & 0x3f); // variant 10xx

	const hex = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");

	return [
		hex.slice(0, 8),
		hex.slice(8, 12),
		hex.slice(12, 16),
		hex.slice(16, 20),
		hex.slice(20),
	].join("-");
}
