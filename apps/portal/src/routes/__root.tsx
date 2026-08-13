import { createRootRouteWithContext, Outlet, HeadContent } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { Providers } from "@fluxify/components";
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
