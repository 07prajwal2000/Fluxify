import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button, useCustomBlockParamsTypes, type CustomBlockParamDef } from "@fluxify/components";
import { TbSettings } from "react-icons/tb";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { customBlocksService } from "@/services/customBlocks";
import { CanvasWorkbench } from "@/components/canvas";
import { CustomBlockSettingsModal } from "@/components/customBlocks/CustomBlockSettingsModal";
import { CustomBlockSwitcher } from "@/components/customBlocks/CustomBlockSwitcher";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute(
	"/_authed/$projectId_/custom-block-canvas/$blockId",
)({
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
		return Array.isArray(self?.inputParams)
			? (self.inputParams as CustomBlockParamDef[])
			: [];
	}, [blocks, blockId]);
	useCustomBlockParamsTypes(inputParams);

	return (
		<>
			<CanvasWorkbench
				title="Custom block canvas"
				enableBlockPicker
				items={customBlocksQuery.canvasItems.useQuery(blockId)}
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
