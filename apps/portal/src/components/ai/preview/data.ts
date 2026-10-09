export type Data = Record<string, unknown>;

export const isRec = (v: unknown): v is Data =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** A record, or an empty one: tool inputs and outputs are only as trustworthy as the model. */
export const rec = (v: unknown): Data => (isRec(v) ? v : {});

export const str = (v: unknown) =>
	typeof v === "string" || typeof v === "number" ? String(v) : "";

/** Deep equality for JSON values. */
export function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((x, i) => same(x, b[i]));
	if (isRec(a) && isRec(b)) {
		const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
		return [...keys].every((k) => same(a[k], b[k]));
	}
	return false;
}

/** A value as text: strings as they are, everything else as indented JSON. */
export const fmt = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v, null, 2) ?? ""));

/** One line of it, cut. */
export function oneLine(v: unknown, max = 80) {
	const s = (typeof v === "string" ? v : (JSON.stringify(v) ?? "")).replace(/\s+/g, " ").trim();
	return s.length > max ? `${s.slice(0, max)}…` : s;
}

const SECRET = /secret|password|passwd|token|api[-_]?key|private[-_]?key|credential|authorization/i;
export const isSecretKey = (key: string) => SECRET.test(key);
export const MASK = "••••••••";

/**
 * A copy with secret values hidden: any field named like a secret, whatever its
 * depth. A `cfg:NAME` reference points at an app config entry and is no secret.
 */
export function mask(value: unknown, key = ""): unknown {
	if (Array.isArray(value)) return value.map((v) => mask(v, key));
	if (isRec(value))
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mask(v, k)]));
	if (typeof value === "string" && value.startsWith("cfg:")) return value;
	return isSecretKey(key) && value !== null && value !== "" ? MASK : value;
}
