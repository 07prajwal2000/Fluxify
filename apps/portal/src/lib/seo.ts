export const FAVICON_ICO_PATH = "/_/admin/ui/favicon.ico";

/**
 * Generates TanStack Router head configuration with SEO title, meta description, and favicon.
 */
export function createRouteHead(title: string, description?: string) {
	const fullTitle = title.includes("Fluxify") ? title : `${title} | Fluxify`;
	return () => ({
		meta: [
			{ title: fullTitle },
			...(description ? [{ name: "description", content: description }] : []),
		],
		links: [{ rel: "icon", href: FAVICON_ICO_PATH }],
	});
}

/**
 * Generates dynamic TanStack Router head configuration based on route context (params/search).
 */
export function createDynamicRouteHead<T = any>(
	fn: (ctx: T) => { title: string; description?: string },
) {
	return (ctx: any) => {
		const { title, description } = fn(ctx as T);
		const fullTitle = title.includes("Fluxify") ? title : `${title} | Fluxify`;
		return {
			meta: [
				{ title: fullTitle },
				...(description ? [{ name: "description", content: description }] : []),
			],
			links: [{ rel: "icon", href: FAVICON_ICO_PATH }],
		};
	};
}
