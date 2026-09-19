import { useEffect, useMemo } from "react";

const ID = "fluxify-route-params";
const VIRTUAL_PATH = "file:///fluxify-route-params.d.ts";

const quote = (val: string) => JSON.stringify(val);

export function buildRouteParamTypeLib(routeParams?: string[], queryParams?: string[]): string {
	const validRouteParams = Array.from(new Set(routeParams?.filter(Boolean) ?? []));
	const validQueryParams = Array.from(new Set(queryParams?.filter(Boolean) ?? []));

	if (validRouteParams.length === 0 && validQueryParams.length === 0) {
		return "";
	}

	const parts: string[] = [];

	if (validRouteParams.length > 0) {
		const paramUnion = validRouteParams.map(quote).join(" | ");
		parts.push(
			`/** Get a path parameter defined in the route pattern. */\ndeclare function getRouteParam(key: ${paramUnion} | (string & {})): string;`,
		);
	}

	if (validQueryParams.length > 0) {
		const queryUnion = validQueryParams.map(quote).join(" | ");
		parts.push(
			`/** Get a query parameter passed in the request URL. */\ndeclare function getQueryParam(key: ${queryUnion} | (string & {})): string;`,
		);
	}

	return `${parts.join("\n\n")}\n`;
}

/**
 * Registers ambient route and query parameter declarations in Monaco
 * for autocomplete suggestions inside JS editors.
 */
export function useRouteParamTypes(routeParams?: string[], queryParams?: string[]) {
	const lib = useMemo(
		() => buildRouteParamTypeLib(routeParams, queryParams),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[JSON.stringify(routeParams), JSON.stringify(queryParams)],
	);

	useEffect(() => {
		if (!lib) return;
		let live = true;
		const registry = import("./typeLibRegistry");
		void registry.then((module) => {
			if (live) module.registerTypeLib(ID, lib, VIRTUAL_PATH);
		});
		return () => {
			live = false;
			void registry.then((module) => module.unregisterTypeLib(ID));
		};
	}, [lib]);
}
