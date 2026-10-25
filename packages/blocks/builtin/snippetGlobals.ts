import { SNIPPET_GLOBALS } from "../scope";

/**
 * Gives `body`'s inlined user code `globals` by name while it runs, then
 * restores what was there: a graph variable with the same name (a `dbQuery`, a
 * `kv`) keeps its value (#514). They sit in the scope's snippet globals, not on
 * vars, so vars never has a key deleted (#944).
 */
export async function withGlobals<T>(
	vars: Record<string | symbol, unknown>,
	globals: Record<string, unknown>,
	body: () => Promise<T>,
): Promise<T> {
	vars[SNIPPET_GLOBALS] ??= {};
	const own = vars[SNIPPET_GLOBALS] as Record<string, unknown>;
	const saved = Object.keys(globals).map((key) => ({
		key,
		had: Object.hasOwn(own, key),
		value: own[key],
	}));
	Object.assign(own, globals);
	try {
		return await body();
	} finally {
		for (const { key, had, value } of saved) {
			if (had) own[key] = value;
			else delete own[key];
		}
	}
}
