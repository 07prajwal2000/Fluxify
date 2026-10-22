import { afterAll, afterEach, expect, test } from "bun:test";
import { readPageSize } from "./pageSize";

// a stand-in for this file only: test:unit shares one process, so put the real one back
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
afterAll(() => {
	if (original) Object.defineProperty(globalThis, "localStorage", original);
	else delete (globalThis as { localStorage?: unknown }).localStorage;
});
const store = new Map<string, string>();
Object.assign(globalThis, {
	localStorage: {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => store.set(k, v),
	},
});
afterEach(() => store.clear());

test("a saved page size comes back; anything else falls back", () => {
	expect(readPageSize("k", 5)).toBe(5);
	store.set("k", "20");
	expect(readPageSize("k", 5)).toBe(20);
	// not one of the sizes the API accepts
	store.set("k", "7");
	expect(readPageSize("k", 5)).toBe(5);
	store.set("k", "junk");
	expect(readPageSize("k", 5)).toBe(5);
});
