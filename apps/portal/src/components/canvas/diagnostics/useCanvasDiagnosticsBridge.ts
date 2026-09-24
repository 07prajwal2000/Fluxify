import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { flowToGraph } from "../adapters";
import { DIAGNOSTICS_TAB } from "../panel/BlockSettings";
import type { CanvasPanel } from "../panel/useBlockPanel";
import type { BlockEdge, BlockNode } from "../types";
import { BLOCK_CONFIG_SOURCE, validateBlockConfigs } from "./blockConfigValidator";
import { CYCLE_DETECTION_SOURCE, validateCycles } from "./cycleValidator";
import { useBlockDiagnostics } from "./DiagnosticsContext";
import { SWITCH_SOURCE, validateSwitches } from "./switchValidator";
import {
	TRANSACTION_SOURCE,
	transactionTopologyKey,
	validateTransactions,
} from "./transactionValidator";

export type UseCanvasDiagnosticsBridgeOptions = {
	nodes: BlockNode[];
	edges: BlockEdge[];
	setNodes: React.Dispatch<React.SetStateAction<BlockNode[]>>;
	panel: CanvasPanel;
};

export function useCanvasDiagnosticsBridge({
	nodes,
	edges,
	setNodes,
	panel,
}: UseCanvasDiagnosticsBridgeOptions) {
	const diagnostics = useBlockDiagnostics();
	const { setCenter } = useReactFlow();

	const {
		isPanelOpen: isDiagnosticsOpen,
		closePanel: closeDiagnosticsPanel,
		setFromSource,
		registerValidator,
	} = diagnostics;
	const { openBlockId, close: closeBlockPanel, open: openBlockPanel } = panel;

	// Mutual exclusivity: close the previous panel when the other one opens
	const prevOpenBlockId = useRef<string | null>(openBlockId);
	const prevDiagnosticsOpen = useRef<boolean>(isDiagnosticsOpen);

	useEffect(() => {
		const blockJustOpened = !prevOpenBlockId.current && !!openBlockId;
		const diagnosticsJustOpened = !prevDiagnosticsOpen.current && isDiagnosticsOpen;

		prevOpenBlockId.current = openBlockId;
		prevDiagnosticsOpen.current = isDiagnosticsOpen;

		if (blockJustOpened && isDiagnosticsOpen) {
			closeDiagnosticsPanel();
		} else if (diagnosticsJustOpened && openBlockId) {
			closeBlockPanel();
		}
	}, [openBlockId, isDiagnosticsOpen, closeDiagnosticsPanel, closeBlockPanel]);

	const wrappedPanel = useMemo(
		() => ({
			...panel,
			open: (blockId: string, tab?: string) => {
				closeDiagnosticsPanel();
				panel.open(blockId, tab);
			},
		}),
		[panel, closeDiagnosticsPanel],
	);

	const handleSelectBlock = useCallback(
		(blockId: string, tab: string = DIAGNOSTICS_TAB) => {
			const targetNode = nodes.find((n) => n.id === blockId);
			if (targetNode) {
				setNodes((current) => current.map((n) => ({ ...n, selected: n.id === blockId })));
				setCenter(targetNode.position.x + 80, targetNode.position.y + 40, {
					duration: 300,
				});
			}
			closeDiagnosticsPanel();
			openBlockPanel(blockId, tab);
		},
		[closeDiagnosticsPanel, nodes, openBlockPanel, setCenter, setNodes],
	);

	// Register graph validators on the diagnostics engine
	useEffect(() => {
		const offCycles = registerValidator(CYCLE_DETECTION_SOURCE, () =>
			validateCycles(flowToGraph(nodes, edges)),
		);
		const offSwitches = registerValidator(SWITCH_SOURCE, () =>
			validateSwitches(flowToGraph(nodes, edges)),
		);
		const offConfigs = registerValidator(BLOCK_CONFIG_SOURCE, () =>
			validateBlockConfigs(flowToGraph(nodes, edges)),
		);
		const offTransactions = registerValidator(TRANSACTION_SOURCE, () =>
			validateTransactions(flowToGraph(nodes, edges)),
		);
		return () => {
			offCycles();
			offSwitches();
			offConfigs();
			offTransactions();
		};
	}, [nodes, edges, registerValidator]);

	// Automatically run them on graph edits
	useEffect(() => {
		const currentGraph = flowToGraph(nodes, edges);
		setFromSource(CYCLE_DETECTION_SOURCE, validateCycles(currentGraph));
		setFromSource(SWITCH_SOURCE, validateSwitches(currentGraph));
		setFromSource(BLOCK_CONFIG_SOURCE, validateBlockConfigs(currentGraph));
	}, [nodes, edges, setFromSource]);

	// The transaction walks depend only on wiring, so they skip drags and setting edits
	const transactions = useMemo(() => {
		const graph = flowToGraph(nodes, edges);
		return { graph, key: transactionTopologyKey(graph) };
	}, [nodes, edges]);
	const latestTransactions = useRef(transactions);
	latestTransactions.current = transactions;
	const transactionKey = transactions.key;
	useEffect(() => {
		// an empty key means no transaction or rollback block, so nothing to check
		setFromSource(
			TRANSACTION_SOURCE,
			transactionKey ? validateTransactions(latestTransactions.current.graph) : [],
		);
	}, [transactionKey, setFromSource]);

	return {
		diagnostics,
		wrappedPanel,
		handleSelectBlock,
	};
}
