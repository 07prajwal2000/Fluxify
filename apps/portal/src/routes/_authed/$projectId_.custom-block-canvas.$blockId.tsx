import { createFileRoute } from "@tanstack/react-router";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { customBlocksService } from "@/services/customBlocks";
import { CanvasWorkbench } from "@/components/canvas";

export const Route = createFileRoute(
	"/_authed/$projectId_/custom-block-canvas/$blockId",
)({
	component: CustomBlockCanvasPage,
});

function CustomBlockCanvasPage() {
	const { blockId } = Route.useParams();
	const save = customBlocksQuery.saveCanvas.mutation(blockId);

	return (
		<CanvasWorkbench
			title="Custom block canvas"
			items={customBlocksQuery.canvasItems.useQuery(blockId)}
			reload={() => customBlocksService.getCanvasItems(blockId)}
			save={(payload) => save.mutateAsync(payload)}
		/>
	);
}
