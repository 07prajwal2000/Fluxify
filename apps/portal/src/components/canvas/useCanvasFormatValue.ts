import type { MutableRefObject } from "react";
import { useCallback, useMemo, useState } from "react";
import type { CanvasSnapshot, useCanvasHistory } from "./history";
import { layoutBlocks } from "./layout";
import type { BlockEdge, BlockNode } from "./types";

export function useCanvasFormatValue({
	enableFormat,
	readOnly,
	layoutLocked,
	latest,
	history,
	applySnapshot,
}: {
	enableFormat: boolean;
	readOnly: boolean;
	layoutLocked: boolean;
	latest: MutableRefObject<{ nodes: BlockNode[]; edges: BlockEdge[] }>;
	history: ReturnType<typeof useCanvasHistory>;
	applySnapshot: (snapshot: CanvasSnapshot) => void;
}) {
	const [isFormatting, setIsFormatting] = useState(false);
	const formatEnabled = enableFormat && !readOnly && !layoutLocked;

	const format = useCallback(async () => {
		if (!formatEnabled) return;
		setIsFormatting(true);
		try {
			const { nodes: current, edges: currentEdges } = latest.current;
			const positions = await layoutBlocks(current, currentEdges);
			if (Object.keys(positions).length === 0) return;
			history.commit();
			applySnapshot({
				nodes: current.map((node) => ({
					...node,
					position: positions[node.id] ?? node.position,
				})),
				edges: latest.current.edges,
			});
		} finally {
			setIsFormatting(false);
		}
	}, [formatEnabled, history, applySnapshot, latest]);

	return useMemo(
		() => ({ enabled: formatEnabled, format, isFormatting }),
		[formatEnabled, format, isFormatting],
	);
}
