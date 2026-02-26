import { showNotification } from "@mantine/notifications";
import { generateID } from "@fluxify/lib";
import { useReactFlow } from "@xyflow/react";
import {
	useCanvasActionsStore,
	useCanvasBlocksStore,
	useCanvasEdgesStore,
} from "@/store/canvas";
import { useEditorChangeTrackerStore } from "@/store/editor";
import { useBlockDataActionsStore } from "@/store/blockDataStore";
import { BlockTypes, EdgeType } from "@/types/block";
import { createBlockData } from "@/lib/blockFactory";

export function useBlockHistory() {
	const {
		blocks: {
			deleteBlock,
			addBlock,
			deleteBulk: deleteBulkBlocks,
			setSelection: setBlocksSelection,
		},
		edges: {
			addEdge,
			deleteEdge,
			deleteBulk: deleteBulkEdges,
			setSelection: setEdgesSelection,
		},
	} = useCanvasActionsStore();

	const blocks = useCanvasBlocksStore();
	const edges = useCanvasEdgesStore();
	const changeTracker = useEditorChangeTrackerStore();
	const { updateBlockData, deleteBlockData } = useBlockDataActionsStore();
	const { screenToFlowPosition } = useReactFlow();

	function createNewBlock(
		id: string,
		position: { x: number; y: number },
		block: BlockTypes,
		data?: any,
	) {
		const blockData = data ?? createBlockData(block);
		addBlock({ id, position, type: block, data: blockData });
		updateBlockData(id, blockData);
		changeTracker.add(id, "block");
	}

	function duplicateBlock(id: string) {
		const block = blocks.find((b) => b.id === id);
		const isUnduplitable =
			!block ||
			block.type === BlockTypes.entrypoint ||
			block.type === BlockTypes.errorHandler;

		if (isUnduplitable) {
			showNotification({
				message: "Cannot duplicate Entrypoint/Error handler block",
				color: "red",
				id: "duplicate-block-error-notification",
			});
			return;
		}

		const newId = generateID();
		const position = { x: block.position.x + 50, y: block.position.y + 50 };
		createNewBlock(newId, position, block.type, block.data);
		return newId;
	}

	function duplicateSelection(blockIds: string[]) {
		const oldIdToNewIdMap = new Map<string, string>();

		blockIds.forEach((id) => {
			const newId = duplicateBlock(id);
			if (newId) oldIdToNewIdMap.set(id, newId);
		});

		edges
			.filter((e) => blockIds.includes(e.source) && blockIds.includes(e.target))
			.forEach((edge) => {
				const newId = generateID();
				const srcHandle = edge.sourceHandle.slice(
					edge.sourceHandle.lastIndexOf("-") + 1,
				);
				const tgtHandle = edge.targetHandle.slice(
					edge.targetHandle.lastIndexOf("-") + 1,
				);
				const newSrc = oldIdToNewIdMap.get(edge.source)!;
				const newTgt = oldIdToNewIdMap.get(edge.target)!;

				addEdge({
					id: newId,
					source: newSrc,
					target: newTgt,
					sourceHandle: `${newSrc}-${srcHandle}`,
					targetHandle: `${newTgt}-${tgtHandle}`,
					type: "custom",
				} as any);

				changeTracker.add(newId, "edge");
			});

		setBlocksSelection(Array.from(oldIdToNewIdMap.values()), true);
		setEdgesSelection(Array.from(oldIdToNewIdMap.values()), true);
	}

	function deleteEdgeWithHistory(id: string) {
		changeTracker.add(id, "edge");
		deleteEdge(id);
	}

	function deleteBlockWithHistory(id: string) {
		changeTracker.add(id, "block");
		edges
			.filter((e) => e.source === id || e.target === id)
			.forEach((e) => deleteEdgeWithHistory(e.id));
		deleteBlock(id);
		deleteBlockData(id);
	}

	function deleteBulkWithHistory(ids: string[], type: "block" | "edge") {
		if (type === "block") {
			deleteBulkBlocks(new Set(ids));

			const connectedEdges = edges.filter(
				(e) => ids.includes(e.source) || ids.includes(e.target),
			);
			const connectedEdgesIds = connectedEdges.map((e) => e.id);
			if (connectedEdgesIds.length > 0) {
				deleteBulkEdges(new Set(connectedEdgesIds));
				connectedEdgesIds.forEach((id) => changeTracker.add(id, "edge"));
			}
		} else {
			deleteBulkEdges(new Set(ids));
		}

		ids.forEach((id) => changeTracker.add(id, type));
	}

	function addBlockWithHistory(block: BlockTypes) {
		const position = screenToFlowPosition({
			x: document.body.offsetWidth / 2,
			y: document.body.offsetHeight / 2,
		});
		createNewBlock(generateID(), position, block, createBlockData(block));
	}

	function updateBlockDataWithHistory(id: string, data: any) {
		changeTracker.add(id, "block");
		updateBlockData(id, data);
	}

	function pasteSelection(clipboardData: any) {
		const oldIdToNewIdMap = new Map<string, string>();
		const newBlockIds: string[] = [];

		clipboardData.blocks.forEach((block: any) => {
			const isUnduplitable =
				block.type === BlockTypes.entrypoint ||
				block.type === BlockTypes.errorHandler;

			if (isUnduplitable) return;

			const newId = generateID();
			oldIdToNewIdMap.set(block.id, newId);
			newBlockIds.push(newId);

			const position = { x: block.position.x + 50, y: block.position.y + 50 };
			createNewBlock(newId, position, block.type, block.data);
		});

		clipboardData.edges.forEach((edge: any) => {
			if (
				!oldIdToNewIdMap.has(edge.source) ||
				!oldIdToNewIdMap.has(edge.target)
			) {
				return;
			}

			const newId = generateID();
			const srcHandle = edge.sourceHandle.slice(
				edge.sourceHandle.lastIndexOf("-") + 1,
			);
			const tgtHandle = edge.targetHandle.slice(
				edge.targetHandle.lastIndexOf("-") + 1,
			);
			const newSrc = oldIdToNewIdMap.get(edge.source)!;
			const newTgt = oldIdToNewIdMap.get(edge.target)!;

			addEdge({
				id: newId,
				source: newSrc,
				target: newTgt,
				sourceHandle: `${newSrc}-${srcHandle}`,
				targetHandle: `${newTgt}-${tgtHandle}`,
				type: "custom",
			} as any);

			changeTracker.add(newId, "edge");
		});

		setBlocksSelection(newBlockIds, true);
		setEdgesSelection(newBlockIds, true);
	}

	return {
		pasteSelection,
		createNewBlock,
		duplicateBlock,
		duplicateSelection,
		deleteEdgeWithHistory,
		deleteBlockWithHistory,
		deleteBulkWithHistory,
		addBlockWithHistory,
		updateBlockDataWithHistory,
	};
}
