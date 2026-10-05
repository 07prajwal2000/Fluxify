/**
 * Puts `globals` on vars while `body` runs, then restores what was there: a
 * graph variable with the same name (a `dbQuery`, a `kv`) keeps its value
 * instead of being deleted afterwards (#514). Inlined user code reaches vars
 * through the scope proxy.
 */
export async function withGlobals<T>(
	vars: Record<string, unknown>,
	globals: Record<string, unknown>,
	body: () => Promise<T>,
): Promise<T> {
	const saved = Object.keys(globals).map((key) => ({
		key,
		had: Object.hasOwn(vars, key),
		value: vars[key],
	}));
	Object.assign(vars, globals);
	try {
		return await body();
	} finally {
		for (const { key, had, value } of saved) {
			if (had) vars[key] = value;
			else delete vars[key];
		}
	}
}
