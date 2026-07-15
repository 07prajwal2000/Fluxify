import { useEditorChangeTrackerStore } from "@/store/editor";
import { Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useParams } from "next/navigation";
import { TbDeviceFloppy } from "react-icons/tb";
import { useCanvasSave } from "@/hooks/useCanvasState";
import { useFlowEditorContext } from "@/components/editor/flowEditor/flowEditorContext";

const SaveEditorButton = () => {
	const { entityId, entityType, readonly } = useFlowEditorContext();
	const changeTracker = useEditorChangeTrackerStore();
	const disableButton = changeTracker.tracker.size === 0;
	const { routeId } = useParams<{ routeId: string }>();
	const { onSave } = useCanvasSave(entityId ?? "", entityType ?? "route");

	async function onSaveClicked() {
		await onSave();
	}

	return (
		<Button
			size="xs"
			disabled={disableButton}
			variant="light"
			onClick={onSaveClicked}
			color="violet"
			leftSection={<TbDeviceFloppy size={18} />}
		>
			Save
		</Button>
	);
};

export default SaveEditorButton;
