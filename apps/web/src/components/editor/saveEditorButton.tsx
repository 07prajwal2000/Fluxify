import { useEditorChangeTrackerStore } from "@/store/editor";
import { Button } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useParams } from "next/navigation";
import { TbDeviceFloppy } from "react-icons/tb";
import { useCanvasSave } from "@/hooks/useCanvasState";

const SaveEditorButton = () => {
	const changeTracker = useEditorChangeTrackerStore();
	const disableButton = changeTracker.tracker.size === 0;
	const { id: routeId } = useParams<{ id: string }>();
	const { onSave } = useCanvasSave(routeId);

	async function onSaveClicked() {
		const notificationId = "canvas-save-success";

		// 1. Initial UI Feedback
		notifications.show({
			id: notificationId,
			loading: true,
			message: "Saving...",
			color: "violet",
			withCloseButton: false,
		});

		try {
			// 2. Delegate to the main business logic
			// We assume onSave handles its own internal data processing
			await onSave();

			// 3. Success UI State
			notifications.update({
				id: notificationId,
				loading: false,
				message: "Successfully saved",
				color: "green",
				autoClose: 3000, // Optional: auto-close after 3 seconds
				withCloseButton: true,
			});
		} catch (error: any) {
			// 4. Error UI State
			notifications.update({
				id: notificationId,
				loading: false,
				message: "Failed to save changes",
				color: "red",
				withCloseButton: true,
			});

			console.error("Save operation failed:", error);
		}
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
