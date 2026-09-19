import { Providers } from "@fluxify/components";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, HeadContent, Outlet } from "@tanstack/react-router";
import { createRouteHead } from "@/lib/seo";

export interface RouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
	head: createRouteHead(
		"Fluxify | API & Workflow Automation Platform",
		"Build, automate, and orchestrate API workflows, custom blocks, and 3rd party integrations with Fluxify.",
	),
	component: () => (
		<Providers>
			<HeadContent />
			<Outlet />
		</Providers>
	),
});
