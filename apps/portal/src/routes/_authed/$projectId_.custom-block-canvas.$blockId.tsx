import { Button, type CustomBlockParamDef, useCustomBlockParamsTypes } from "@fluxify/components";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TbSettings } from "react-icons/tb";
import { CanvasWorkbench } from "@/components/canvas";
import { CustomBlockSettingsModal } from "@/components/customBlocks/CustomBlockSettingsModal";
import { CustomBlockSwitcher } from "@/components/customBlocks/CustomBlockSwitcher";
import { createRouteHead } from "@/lib/seo";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { customBlocksService } from "@/services/customBlocks";

export const Route = createFileRoute("/_authed/$projectId_/custom-block-canvas/$blockId")({
	head: createRouteHead(
		"Custom Block Canvas",
		"Design and build reusable custom automation blocks.",
	),
	component: CustomBlockCanvasPage,
});

function CustomBlockCanvasPage() {
	const { projectId, blockId } = Route.useParams();
	const save = customBlocksQuery.saveCanvas.mutation(blockId);
	const [settingsOpen, setSettingsOpen] = useState(false);

	// `params.<name>` is only in scope inside this block's own canvas, so the
	// completions for it are registered here rather than with the static globals.
	const { data: blocks } = customBlocksQuery.getAll.useQuery(projectId);
	const inputParams = useMemo(() => {
		const self = blocks?.find((block) => block.id === blockId);
		return Array.isArray(self?.inputParams) ? (self.inputParams as CustomBlockParamDef[]) : [];
	}, [blocks, blockId]);
	useCustomBlockParamsTypes(inputParams);

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
