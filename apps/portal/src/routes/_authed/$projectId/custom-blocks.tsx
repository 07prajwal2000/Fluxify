import { CUSTOM_BLOCK_USAGES } from "@fluxify/server/src/lib/customBlockUsage";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { CustomBlocksView } from "@/components/customBlocks/CustomBlocksView";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/custom-blocks")({
	head: createRouteHead(
		"Custom Blocks",
		"Manage custom reusable workflow blocks for your project.",
	),
	// a bad ?usage= falls back to All instead of erroring the page
	validateSearch: z.object({
		usage: z.enum(CUSTOM_BLOCK_USAGES).optional().catch(undefined),
		// ?plugins=true also lists the blocks plugins ship
		plugins: z.boolean().optional().catch(undefined),
	}),
	component: CustomBlocksPage,
});

function CustomBlocksPage() {
	const { projectId } = Route.useParams();
	const { usage, plugins } = Route.useSearch();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Custom Blocks"));
	const navigate = useNavigate();

	return (
		<CustomBlocksView
			projectId={projectId}
			usage={usage}
			showPlugins={plugins === true}
			onUsageChange={(next) =>
				navigate({ to: ".", search: (prev) => ({ ...prev, usage: next }), replace: true })
			}
			onShowPluginsChange={(show) =>
				navigate({
					to: ".",
					search: (prev) => ({ ...prev, plugins: show || undefined }),
					replace: true,
				})
			}
			onOpenBlock={(blockId) =>
				navigate({ to: "/$projectId/custom-block-canvas/$blockId", params: { projectId, blockId } })
			}
			onNewBlock={() => navigate({ to: "/$projectId/custom-blocks/new", params: { projectId } })}
		/>
	);
}
