import { useEffect, useRef } from "react";
import { useCanvasBlocksStore, useCanvasEdgesStore } from "@/store/canvas";
import { useBlockDataStore } from "@/store/blockDataStore";
import { useEditorActionsStore } from "@/store/editor";

export function useCanvasSnapshot() {
	const blocks = useCanvasBlocksStore();
	const edges = useCanvasEdgesStore();
	const blockData = useBlockDataStore();
	const { record, disableRecording } = useEditorActionsStore();

	const prevStateRef = useRef<string | null>(null);
	const wasDisabled = useRef<boolean>(false);

	useEffect(() => {
		if (disableRecording) {
			wasDisabled.current = true;
			return;
		}

		const currentState = JSON.stringify({ blocks, edges, blockData });

		if (wasDisabled.current || !prevStateRef.current) {
			prevStateRef.current = currentState;
			wasDisabled.current = false;
			return;
		}

		if (prevStateRef.current === currentState) return;

		const timeoutId = setTimeout(() => {
			if (prevStateRef.current && prevStateRef.current !== currentState) {
				record(JSON.parse(prevStateRef.current));
			}
			prevStateRef.current = currentState;
		}, 500);

		return () => clearTimeout(timeoutId);
	}, [blocks, edges, blockData, disableRecording, record]);

	return null;
}
