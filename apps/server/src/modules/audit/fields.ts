const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Names of the properties whose value differs between `before` and `after`.
 * Only the names leave this function, so a changed password is "password" and
 * nothing more. Nested objects are listed as `parent.child`.
 */
export function changedFields(before: unknown, after: unknown, prefix = ""): string[] {
	const a = isObject(before) ? before : {};
	const b = isObject(after) ? after : {};
	const names: string[] = [];
	for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
		if (b[key] === undefined) continue; // not part of this change
		const path = prefix ? `${prefix}.${key}` : key;
		if (isObject(a[key]) && isObject(b[key])) names.push(...changedFields(a[key], b[key], path));
		else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) names.push(path);
	}
	return names;
}

/** Property names present in a request body, for a service that never sees the old value. */
export function bodyFields(body: unknown): string[] {
	return isObject(body) ? Object.keys(body).filter((k) => body[k] !== undefined) : [];
}
