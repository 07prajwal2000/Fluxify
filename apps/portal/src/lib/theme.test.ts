import { expect, test, beforeEach, afterEach } from "bun:test";
import { getTheme, setTheme, toggleTheme, initTheme } from "./theme";

const classList = new Set<string>();
const attributes = new Map<string, string>();
const storage = new Map<string, string>();

const originalDocument = globalThis.document;
const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
	classList.clear();
	classList.add("dark");
	attributes.clear();
	storage.clear();

	globalThis.document = {
		documentElement: {
			classList: {
				contains: (c: string) => classList.has(c),
				add: (c: string) => classList.add(c),
				remove: (c: string) => classList.delete(c),
			},
			getAttribute: (k: string) => attributes.get(k) ?? null,
			setAttribute: (k: string, v: string) => attributes.set(k, v),
		},
	} as unknown as Document;

	globalThis.localStorage = {
		getItem: (k: string) => storage.get(k) ?? null,
		setItem: (k: string, v: string) => storage.set(k, v),
		clear: () => storage.clear(),
	} as unknown as Storage;
});

afterEach(() => {
	globalThis.document = originalDocument;
	globalThis.localStorage = originalLocalStorage;
});

test("getTheme detects dark and light theme", () => {
	document.documentElement.classList.add("dark");
	document.documentElement.classList.remove("light");
	expect(getTheme()).toBe("dark");

	document.documentElement.classList.remove("dark");
	document.documentElement.classList.add("light");
	expect(getTheme()).toBe("light");
});

test("setTheme updates class, data-theme, and localStorage", () => {
	setTheme("light");
	expect(document.documentElement.classList.contains("light")).toBe(true);
	expect(document.documentElement.classList.contains("dark")).toBe(false);
	expect(document.documentElement.getAttribute("data-theme")).toBe("light");
	expect(localStorage.getItem("theme")).toBe("light");

	setTheme("dark");
	expect(document.documentElement.classList.contains("dark")).toBe(true);
	expect(document.documentElement.classList.contains("light")).toBe(false);
	expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
	expect(localStorage.getItem("theme")).toBe("dark");
});

test("toggleTheme flips between dark and light", () => {
	setTheme("dark");
	expect(toggleTheme()).toBe("light");
	expect(getTheme()).toBe("light");
	expect(toggleTheme()).toBe("dark");
	expect(getTheme()).toBe("dark");
});

test("initTheme loads persisted theme from localStorage", () => {
	localStorage.setItem("theme", "light");
	initTheme();
	expect(getTheme()).toBe("light");
});
