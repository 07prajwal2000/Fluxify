import { Button, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { TbLayoutSidebarRightCollapse, TbLayoutSidebarRightExpand } from "react-icons/tb";
import { z } from "zod";
import { CustomBlockSwitcher } from "@/components/customBlocks/CustomBlockSwitcher";
import { RouteWorkbenchHeader } from "@/components/routes/RouteWorkbenchTabs";
import { ProductionChip } from "@/components/versions/ProductionChip";
import { VersionHistory, type VersionTab } from "@/components/versions/VersionHistory";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { customBlocksService } from "@/services/customBlocks";

export const Route = createFileRoute("/_authed/$projectId_/custom-block-canvas/$blockId_/versions")(
	{
		head: createRouteHead(
			"Custom Block Versions | Custom Blocks",
			"Look back through the saved versions of a custom block and promote one.",
		),
		validateSearch: z.object({
			tab: z.enum(["versions", "production"]).optional().catch(undefined),
			version: z.string().optional(),
		}),
		beforeLoad: async ({ params, context }) => {
			try {
				const block = await context.queryClient.ensureQueryData({
					queryKey: ["custom-blocks", params.blockId, "by-id"],
					queryFn: () => customBlocksService.getById(params.blockId),
				});
				if (!block || block.projectId !== params.projectId) {
					toast.danger("Custom block not found");
					throw redirect({
						to: "/$projectId/custom-blocks",
						params: { projectId: params.projectId },
					});
				}
			} catch (err) {
				if (isRedirect(err)) throw err;
				toast.danger("Custom block not found");
				throw redirect({
					to: "/$projectId/custom-blocks",
					params: { projectId: params.projectId },
				});
			}
		},
		component: CustomBlockVersionsPage,
	},
);

function CustomBlockVersionsPage() {
	const { projectId, blockId } = Route.useParams();
	const { tab: tabParam, version } = Route.useSearch();
	const tab = tabParam ?? "versions";
	const navigate = Route.useNavigate();
	const { data: block } = customBlocksQuery.byId.useQuery(blockId);
	const [settingsOpen, setSettingsOpen] = useState(true);
	usePageTitle(block ? `${block.label} | Versions` : "Custom Block Versions | Custom Blocks");

	return (
		<div className="flex h-screen w-full flex-col">
			<RouteWorkbenchHeader>
				<CustomBlockSwitcher projectId={projectId} blockId={blockId} />
				<div className="ml-auto flex items-center gap-2">
					<ProductionChip kind="custom_block" id={blockId} projectId={projectId} />
					<Button
						isIconOnly
						variant="ghost"
						size="sm"
						aria-label={settingsOpen ? "Hide version settings" : "Show version settings"}
						onPress={() => setSettingsOpen((open) => !open)}
					>
						{settingsOpen ? (
							<TbLayoutSidebarRightCollapse size={16} />
						) : (
							<TbLayoutSidebarRightExpand size={16} />
						)}
					</Button>
				</div>
			</RouteWorkbenchHeader>
			<VersionHistory
				key={blockId}
				kind="custom_block"
				id={blockId}
				projectId={projectId}
				tab={tab}
				onTabChange={(next: VersionTab) =>
					navigate({ search: (prev) => ({ ...prev, tab: next }), replace: true })
				}
				settingsOpen={settingsOpen}
				onBackToCanvas={() =>
					navigate({
						to: "/$projectId/custom-block-canvas/$blockId",
						params: { projectId, blockId },
					})
				}
				onOpenSandbox={() => undefined}
				initialVersionId={version}
			/>
		</div>
	);
}
