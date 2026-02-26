import { BlockCanvasContext } from "@/context/blockCanvas";
import { useCanvasSave } from "@/hooks/useCanvasState";
import { useBlockDataStore } from "@/store/blockDataStore";
import { useCanvasActionsStore } from "@/store/canvas";
import {
	useEditorBlockSettingsStore,
	useEditorSearchbarStore,
} from "@/store/editor";
import { Edge, Node, useOnSelectionChange, useReactFlow } from "@xyflow/react";
import { useParams } from "next/navigation";
import React, { useCallback, useContext, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";

const CanvasKeyboardAccessibility = () => {
	const [selectedBlocks, setSelectedBlock] = useState<string[]>([]);
	const blockData = useBlockDataStore();
	const { getNodes, getEdges } = useReactFlow();
	const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
	const { open: openSearchbar } = useEditorSearchbarStore();
	const { open } = useEditorBlockSettingsStore();
	const { deleteBulk, undo, redo, duplicateSelection } =
		useContext(BlockCanvasContext);
	const onChange = useCallback(
		({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) => {
			setSelectedBlock(nodes.map((node) => node.id));
			setSelectedEdges(edges.map((edge) => edge.id));
		},
		[],
	);

	useOnSelectionChange({
		onChange,
	});
	const { id: routeId } = useParams<{ id: string }>();
	const { onSave } = useCanvasSave(routeId);

	useHotkeys("enter", onEnterClicked, { preventDefault: true }, [
		selectedBlocks,
		open,
	]); // select block
	useHotkeys("shift+a", openSearchbar, { preventDefault: true }, [
		openSearchbar,
	]); // open searchbar
	useHotkeys("shift+d", onDuplicateSelection, { preventDefault: true }, [
		selectedBlocks,
		duplicateSelection,
	]); // duplicate selection
	useHotkeys("ctrl+z", undo, { preventDefault: true }, [undo]); // undo
	useHotkeys("ctrl+c", onCopySelection, { preventDefault: true }, [
		selectedBlocks,
		selectedEdges,
		blockData,
		getNodes,
		getEdges,
	]); // copy selection
	useHotkeys("ctrl+y, ctrl+shift+z", redo, { preventDefault: true }, [redo]); // redo
	useHotkeys("delete, backspace", onDeleteClicked, { preventDefault: true }, [
		selectedBlocks,
		selectedEdges,
		deleteBulk,
	]); // delete
	useHotkeys("ctrl+s", (e) => onSaveClicked(e), { preventDefault: true }, [
		onSave,
	]); // save

	function onSaveClicked(e: KeyboardEvent) {
		e.preventDefault();
		onSave();
	}

	async function onCopySelection() {
		if (selectedBlocks.length === 0 && selectedEdges.length === 0) {
			return;
		}
		// {blocks: [{id, position, type, data}], edges: [{id, source, target, sourceHandle, targetHandle, type}]}
		const blocks: {
			id: string;
			position: { x: number; y: number };
			type: string;
			data: any;
		}[] = [];
		const edges: {
			id: string;
			source: string;
			target: string;
			sourceHandle: string;
			targetHandle: string;
			type: string;
		}[] = [];
		getNodes().forEach((node) => {
			if (selectedBlocks.includes(node.id)) {
				blocks.push({
					id: node.id,
					position: node.position,
					type: node.type!,
					data: blockData[node.id],
				});
			}
		});
		getEdges().forEach((edge) => {
			if (selectedEdges.includes(edge.id)) {
				edges.push({
					id: edge.id,
					source: edge.source,
					target: edge.target,
					sourceHandle: edge.sourceHandle!,
					targetHandle: edge.targetHandle!,
					type: edge.type!,
				});
			}
		});
		await navigator.clipboard.writeText(
			JSON.stringify({ source: "FLUXIFY/COPY_PASTE", data: { blocks, edges } }),
		);
	}

	function onDuplicateSelection() {
		if (selectedBlocks.length === 0) return;
		duplicateSelection(selectedBlocks);
	}

	function onEnterClicked() {
		if (selectedBlocks.length !== 1) {
			return;
		}
		open(selectedBlocks[0]);
	}

	function onDeleteClicked(e: KeyboardEvent) {
		if (selectedBlocks.length === 0 && selectedEdges.length === 0) {
			return;
		}

		deleteBulk(selectedBlocks, "block");
		deleteBulk(selectedEdges, "edge");
	}

	return <></>;
};

export default CanvasKeyboardAccessibility;
