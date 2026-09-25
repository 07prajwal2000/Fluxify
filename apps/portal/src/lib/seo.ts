import { useEffect } from "react";

export const FAVICON_ICO_PATH = "/_/admin/ui/favicon.ico";

/**
 * Formats a page title ensuring the Fluxify brand is appended if not already present.
 */
export function formatTitle(title: string): string {
	const trimmed = title.trim();
	return trimmed.includes("Fluxify") ? trimmed : `${trimmed} | Fluxify`;
}

/**
 * Formats a project page title with the project name and an optional section name.
 * If section is provided: `${projectName} | ${section}` (e.g. "My Store | Routes")
 * If no section is provided: `${projectName} | Project` (e.g. "My Store | Project")
 * If no project name is available: `${section || "Project"}`
 */
export function formatProjectTitle(projectName?: string | null, section?: string): string {
	if (projectName?.trim()) {
		return section?.trim()
			? `${projectName.trim()} | ${section.trim()}`
			: `${projectName.trim()} | Project`;
	}
	return section?.trim() || "Project";
}

/**
 * React hook to reactively set document.title on client navigation / data loading.
 */
export function usePageTitle(title?: string | null) {
	useEffect(() => {
		if (!title?.trim()) return;
		document.title = formatTitle(title);
	}, [title]);
}

/**
 * Generates TanStack Router head configuration with SEO title, meta description, and favicon.
 */
export function createRouteHead(title: string, description?: string) {
	const fullTitle = formatTitle(title);
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
		const enrichedCtx = {
			...ctx,
			search: ctx?.search ?? ctx?.match?.search ?? {},
		};
		const { title, description } = fn(enrichedCtx as T);
		const fullTitle = formatTitle(title);
		return {
			meta: [
				{ title: fullTitle },
				...(description ? [{ name: "description", content: description }] : []),
			],
			links: [{ rel: "icon", href: FAVICON_ICO_PATH }],
		};
	};
}
