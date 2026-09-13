import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { CodeSnippet } from "./types";

type SnippetStore = Map<string, CodeSnippet[]>;

const store: SnippetStore = new Map();
const listeners = new Set<() => void>();

let cachedSnapshot: CodeSnippet[] = [];

function emitChange(): void {
	const map = new Map<string, CodeSnippet>();
	for (const snippets of store.values()) {
		for (const snippet of snippets) {
			map.set(snippet.id, snippet);
		}
	}
	cachedSnapshot = Array.from(map.values());
	for (const listener of listeners) {
		listener();
	}
}

export function registerSnippets(sourceId: string, snippets: CodeSnippet[]): void {
	if (!snippets || snippets.length === 0) {
		if (store.has(sourceId)) {
			store.delete(sourceId);
			emitChange();
		}
		return;
	}
	store.set(sourceId, snippets);
	emitChange();
}

export function unregisterSnippets(sourceId: string): void {
	if (store.has(sourceId)) {
		store.delete(sourceId);
		emitChange();
	}
}

export function getRegisteredSnippets(): CodeSnippet[] {
	return cachedSnapshot;
}

export function clearRegisteredSnippets(): void {
	store.clear();
	emitChange();
}

export function subscribeToSnippets(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * Hook to subscribe to all dynamically registered snippets.
 */
export function useRegisteredSnippets(): CodeSnippet[] {
	return useSyncExternalStore(
		subscribeToSnippets,
		getRegisteredSnippets,
		getRegisteredSnippets,
	);
}

/**
 * Reusable hook for external components to add/remove their snippets on mount/unmount.
 */
export function useRegisterSnippets(
	idOrSnippets: string | CodeSnippet[] | null | undefined,
	maybeSnippets?: CodeSnippet[] | null,
): void {
	const generatedId = useId();
	const id = typeof idOrSnippets === "string" ? idOrSnippets : generatedId;
	const snippets = typeof idOrSnippets === "string" ? maybeSnippets : idOrSnippets;

	const serialized = useMemo(
		() => (snippets ? JSON.stringify(snippets) : ""),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[snippets],
	);

	useEffect(() => {
		if (!snippets || snippets.length === 0) return;
		registerSnippets(id, snippets);
		return () => {
			unregisterSnippets(id);
		};
	}, [id, serialized]);
}

export function toIdentifier(name: string): string {
	const cleaned = name.replace(/[^a-zA-Z0-9_$]/g, "_");
	if (/^[0-9]/.test(cleaned)) return `_${cleaned}`;
	return cleaned || "param";
}

/**
 * Generates intelligent code snippets for route parameters and query parameters.
 */
export function buildRouteParamSnippets(
	routeParams?: string[],
	queryParams?: string[],
): CodeSnippet[] {
	const validRouteParams = Array.from(new Set(routeParams?.filter(Boolean) ?? []));
	const validQueryParams = Array.from(new Set(queryParams?.filter(Boolean) ?? []));

	const snippets: CodeSnippet[] = [];

	// Individual query param snippets
	for (const q of validQueryParams) {
		const varName = toIdentifier(q);
		snippets.push({
			id: `query-param-${q}`,
			title: `Query: ${q}`,
			description: `Read "${q}" query parameter with fallback`,
			category: "params",
			code: `const ${varName} = getQueryParam("${q}") || "";`,
			tags: ["query", "param", q],
		});
	}

	// Batch query params snippet
	if (validQueryParams.length > 1) {
		const lines = validQueryParams.map(
			(q) => `const ${toIdentifier(q)} = getQueryParam("${q}");`,
		);
		snippets.push({
			id: "query-params-all",
			title: "All Query Params",
			description: `Extract all ${validQueryParams.length} query parameters for this route`,
			category: "params",
			code: lines.join("\n"),
			tags: ["query", "params", ...validQueryParams],
		});
	}

	// Individual route param snippets
	for (const p of validRouteParams) {
		const varName = toIdentifier(p);
		snippets.push({
			id: `route-param-${p}`,
			title: `Route Param: ${p}`,
			description: `Get "${p}" route parameter with guard`,
			category: "params",
			code: `const ${varName} = getRouteParam("${p}");\nif (!${varName}) {\n  throw new Error("Missing required route parameter '${p}'");\n}`,
			tags: ["route", "param", p],
		});
	}

	return snippets;
}

const ROUTE_CONTEXT_SNIPPETS_ID = "fluxify-route-param-snippets";

/**
 * Hook to automatically register intelligent route & query param snippets
 * for the currently active route canvas on mount, and clean them up on unmount.
 */
export function useRouteParamSnippets(
	routeParams?: string[],
	queryParams?: string[],
): void {
	const snippets = useMemo(
		() => buildRouteParamSnippets(routeParams, queryParams),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[JSON.stringify(routeParams), JSON.stringify(queryParams)],
	);

	useRegisterSnippets(ROUTE_CONTEXT_SNIPPETS_ID, snippets);
}
