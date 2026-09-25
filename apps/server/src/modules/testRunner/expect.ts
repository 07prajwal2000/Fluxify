import type { AssertionResult } from "../../db/schema";

/**
 * `t.expect` (#483): a small Jest-style subset for custom JS assertions and
 * block hooks.
 *
 * A check records a result line and never throws. Inside a hook a throw already
 * means "fail this block", so a failed check must not look the same.
 *
 * Values often come from a `vm` context — another realm — so nothing here uses
 * `instanceof`: arrays, regexes and plain objects are checked by shape.
 */
export function createExpect(record: (result: AssertionResult) => void) {
	return function expect(actual: unknown, label?: string) {
		const make = (not: boolean) => {
			const check = (verb: string, pass: boolean, expected?: unknown, hasExpected = true) => {
				const ok = not ? !pass : pass;
				const text = `${label ? `${label}: ` : ""}expected ${show(actual)} ${not ? "not " : ""}${verb}${hasExpected ? ` ${show(expected)}` : ""}`;
				record({ success: ok, message: ok ? `${text} ✓` : text });
			};
			return {
				toBe: (e: unknown) => check("to be", Object.is(actual, e), e),
				toEqual: (e: unknown) => check("to equal", deepEqual(actual, e), e),
				toBeTruthy: () => check("to be truthy", !!actual, undefined, false),
				toBeFalsy: () => check("to be falsy", !actual, undefined, false),
				toBeNull: () => check("to be null", actual === null, undefined, false),
				toBeUndefined: () => check("to be undefined", actual === undefined, undefined, false),
				toBeDefined: () => check("to be defined", actual !== undefined, undefined, false),
				toContain: (e: unknown) =>
					check(
						"to contain",
						(typeof actual === "string" || Array.isArray(actual)) && actual.includes(e as never),
						e,
					),
				toHaveLength: (n: number) =>
					check("to have length", (actual as { length?: unknown })?.length === n, n),
				toHaveProperty: (path: string, ...value: unknown[]) => {
					const found = readProperty(actual, path);
					const pass = found.exists && (value.length === 0 || deepEqual(found.value, value[0]));
					check(
						value.length ? `to have property "${path}" equal to` : `to have property "${path}"`,
						pass,
						value[0],
						value.length > 0,
					);
				},
				toMatch: (e: unknown) =>
					check(
						"to match",
						typeof actual === "string" &&
							(typeof e === "string" ? actual.includes(e) : (e as RegExp).test(actual)),
						e,
					),
				toBeGreaterThan: (n: number) => check("to be greater than", (actual as number) > n, n),
				toBeLessThan: (n: number) => check("to be less than", (actual as number) < n, n),
			};
		};
		return Object.assign(make(false), { not: make(true) });
	};
}

export type Expect = ReturnType<typeof createExpect>;

function show(value: unknown) {
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "function" || value === undefined) return String(value);
	// regexes stringify to {} — their source is what the reader wants
	if (Object.prototype.toString.call(value) === "[object RegExp]") return String(value);
	let text: string;
	try {
		text = JSON.stringify(value) ?? String(value);
	} catch {
		text = String(value);
	}
	return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** `a.b[0].c`; `exists` tells a missing key apart from one set to undefined */
function readProperty(target: unknown, path: string) {
	const parts = path
		.replace(/\[(\d+)\]/g, ".$1")
		.split(".")
		.filter(Boolean);
	let curr: any = target;
	for (const p of parts) {
		if (curr === null || typeof curr !== "object" || !(p in curr)) {
			return { exists: false, value: undefined };
		}
		curr = curr[p];
	}
	return { exists: true, value: curr };
}

/** structural, prototype-blind (cross-realm safe) */
function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	// a Date has no own keys, so without this every two dates would be equal
	const tag = Object.prototype.toString.call(a);
	if (tag !== Object.prototype.toString.call(b)) return false;
	if (tag === "[object Date]") return (a as Date).getTime() === (b as Date).getTime();
	const ka = Object.keys(a);
	const kb = Object.keys(b);
	if (ka.length !== kb.length) return false;
	return ka.every((k) => Object.hasOwn(b, k) && deepEqual((a as any)[k], (b as any)[k]));
}
