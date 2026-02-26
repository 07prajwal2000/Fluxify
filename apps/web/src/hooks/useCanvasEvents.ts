import { useEffect } from "react";
import { showNotification } from "@mantine/notifications";
import { generateID } from "@fluxify/lib";
import {
	useEditorActionsStore,
	useEditorBlockSettingsStore,
	useEditorChangeTrackerStore,
} from "@/store/editor";
import { useCanvasActionsStore, useCanvasEdgesStore } from "@/store/canvas";
import { BaseBlockType, clipboardSchema, EdgeType } from "@/types/block";

export function useCanvasEvents(props?: {
	pasteSelection?: (data: any) => void;
}) {
	const {
		edges: { addEdge },
	} = useCanvasActionsStore();
	const changeTracker = useEditorChangeTrackerStore();
	const blockSettings = useEditorBlockSettingsStore();

	useEffect(() => {
		window.onbeforeunload = preventRefresh;
		return () => {
			window.onbeforeunload = null;
		};
	}, [changeTracker.tracker]);

	useEffect(() => {
		window.addEventListener("paste", onPaste);
		return () => {
			window.removeEventListener("paste", onPaste);
		};
	}, [props?.pasteSelection]);

	function preventRefresh(e: BeforeUnloadEvent) {
		if (changeTracker.tracker.size === 0) return;
		const confirmed = confirm(
			"You have unsaved changes, are you sure you want to leave?",
		);
		if (!confirmed) e.preventDefault();
	}

	async function onPaste(e: ClipboardEvent) {
		const text = e.clipboardData?.getData("text");
		if (!text) return;

		try {
			const parsed = JSON.parse(text);
			const { success, data } = clipboardSchema.safeParse(parsed);
			if (!success) {
				showNotification({
					title: "Error",
					message: "Invalid clipboard data",
					color: "red",
				});
				return;
			}

			if (props?.pasteSelection) {
				props.pasteSelection(parsed.data);
			}
		} catch {
			// Invalid JSON, ignore
		}
	}

	function onEdgeConnect(edge: EdgeType) {
		if (edge.source === edge.target) {
			showNotification({
				title: "Error",
				message: "Cannot connect to itself",
				color: "red",
			});
			return;
		}

		edge.id = generateID();
		changeTracker.add(edge.id, "edge");
		(edge as any).type = "custom";

		addEdge(edge);
	}

	function onBlockDragStop(block: BaseBlockType) {
		changeTracker.add(block.id, "block");
	}

	function onBlockDblClick(block: BaseBlockType) {
		blockSettings.open(block.id);
	}

	function openBlock(id: string) {
		blockSettings.open(id);
	}

	return { onEdgeConnect, onBlockDragStop, onBlockDblClick, openBlock };
}
