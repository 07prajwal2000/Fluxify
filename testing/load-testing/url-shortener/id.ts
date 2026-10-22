// Short id generator: 7-char base62, unbiased, one crypto call per ~refill.
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export const ID_LENGTH = 7;
// Bytes >= 248 (62 * 4) are dropped so `byte % 62` has no modulo bias.
const LIMIT = 248;
// One pooled buffer amortizes the crypto syscall across many ids (~12% of bytes are rejected).
const pool = new Uint8Array(ID_LENGTH * 64);
let pos = pool.length;

export function generateId(): string {
	let id = "";
	while (id.length < ID_LENGTH) {
		if (pos === pool.length) {
			crypto.getRandomValues(pool);
			pos = 0;
		}
		const b = pool[pos++];
		if (b < LIMIT) id += ALPHABET[b % 62];
	}
	return id;
}

export const ID_PATTERN = /^[0-9A-Za-z]{7}$/;

if (import.meta.main) {
	const n = 200_000;
	const seen = new Set<string>();
	const counts = new Map<string, number>();
	const t = performance.now();
	for (let i = 0; i < n; i++) {
		const id = generateId();
		if (!ID_PATTERN.test(id)) throw new Error(`bad id ${id}`);
		seen.add(id);
		for (const c of id) counts.set(c, (counts.get(c) ?? 0) + 1);
	}
	const ms = performance.now() - t;
	const expected = (n * ID_LENGTH) / 62;
	const worst = Math.max(...[...counts.values()].map((v) => Math.abs(v - expected) / expected));
	console.log({ n, unique: seen.size, chars: counts.size, worstDeviation: worst.toFixed(4), ms: ms.toFixed(0) });
}
