import {
	Button,
	type CustomBlockParamDef,
	toast,
	useCustomBlockParamsTypes,
	useTestSuiteGlobalTypes,
} from "@fluxify/components";
import { createFileRoute, isRedirect, redirect } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TbSettings } from "react-icons/tb";
import { CanvasWorkbench } from "@/components/canvas";
import { CustomBlockSettingsModal } from "@/components/customBlocks/CustomBlockSettingsModal";
import { CustomBlockSwitcher } from "@/components/customBlocks/CustomBlockSwitcher";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { useProjectPackageTypes } from "@/query/projectPackagesQuery";
import { customBlocksService } from "@/services/customBlocks";

export const Route = createFileRoute("/_authed/$projectId_/custom-block-canvas/$blockId")({
	head: createRouteHead(
		"Custom Block Canvas | Custom Blocks",
		"Design and build reusable custom automation blocks.",
	),
	beforeLoad: async ({ params, context }) => {
		try {
			const blocks = await context.queryClient.ensureQueryData({
				queryKey: ["custom-blocks", params.projectId],
				queryFn: () => customBlocksService.getAll(params.projectId),
			});
			const block = blocks?.find((b: { id: string }) => b.id === params.blockId);
			if (!block) {
				toast.danger("Custom block not found");
				throw redirect({
					to: "/$projectId/routes",
					params: { projectId: params.projectId },
				});
			}
		} catch (err) {
			if (isRedirect(err)) throw err;
			toast.danger("Custom block not found");
			throw redirect({
				to: "/$projectId/routes",
				params: { projectId: params.projectId },
			});
		}
	},
	component: CustomBlockCanvasPage,
});

function CustomBlockCanvasPage() {
	const { projectId, blockId } = Route.useParams();
	useProjectPackageTypes(projectId);
	const save = customBlocksQuery.saveCanvas.mutation(blockId);
	const [settingsOpen, setSettingsOpen] = useState(false);

	// `params.<name>` is only in scope inside this block's own canvas, so the
	// completions for it are registered here rather than with the static globals.
	const { data: blocks } = customBlocksQuery.getAll.useQuery(projectId);
	const self = blocks?.find((block) => block.id === blockId);
	const title = self?.name ? `${self.name} | Custom Blocks` : "Custom Block Canvas | Custom Blocks";
	usePageTitle(title);
	const inputParams = useMemo(
		() => (Array.isArray(self?.inputParams) ? (self.inputParams as CustomBlockParamDef[]) : []),
		[self],
	);
	useCustomBlockParamsTypes(inputParams);
	// `testsuite` exists only when a test-only block runs as a suite's setup / teardown
	useTestSuiteGlobalTypes(Boolean(self?.testOnly));

	return (
		<>
			<CanvasWorkbench
				title="Custom block canvas"
				enableBlockPicker
				enableSpotlight
				items={customBlocksQuery.canvasItems.useQuery(blockId)}
				compileTarget={{ projectId, resourceType: "custom_block", resourceId: blockId }}
				reload={() => customBlocksService.getCanvasItems(blockId)}
				save={(payload) => save.mutateAsync(payload)}
				headerLeft={<CustomBlockSwitcher projectId={projectId} blockId={blockId} />}
				headerActions={
					<Button variant="outline" onPress={() => setSettingsOpen(true)}>
						<TbSettings size={16} /> Settings
					</Button>
				}
			/>
			{/* mounted only while open: the form seeds its state from the loaded block */}
			{settingsOpen && (
				<CustomBlockSettingsModal
					projectId={projectId}
					blockId={blockId}
					isOpen={settingsOpen}
					onOpenChange={setSettingsOpen}
				/>
			)}
		</>
	);
}
