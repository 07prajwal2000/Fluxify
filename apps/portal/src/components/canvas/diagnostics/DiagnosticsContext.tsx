import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	BlockDiagnostic,
	BlockSeverities,
	CanvasDiagnosticsContextValue,
	DiagnosticSeverity,
} from "./types";

const SEVERITY_WEIGHT: Record<DiagnosticSeverity, number> = {
	error: 3,
	warning: 2,
	info: 1,
};

function resolveWorstSeverity(items: BlockDiagnostic[]): DiagnosticSeverity | null {
	let worst: DiagnosticSeverity | null = null;
	for (const item of items) {
		if (!worst || SEVERITY_WEIGHT[item.severity] > SEVERITY_WEIGHT[worst]) {
			worst = item.severity;
		}
	}
	return worst;
}

const NOOP_DIAGNOSTICS: CanvasDiagnosticsContextValue = {
	all: [],
	byBlock: new Map(),
	forBlock: () => [],
	highestSeverityForBlock: () => null,
	severitiesForBlock: () => ({ hasError: false, hasWarning: false, hasInfo: false }),
	worstSeverity: null,
	setForBlock: () => {},
	clearForBlock: () => {},
	setFromSource: () => {},
	clearSource: () => {},
	clearAll: () => {},
	revalidate: () => [],
	registerValidator: () => () => {},
	isPanelOpen: false,
	openPanel: () => {},
	closePanel: () => {},
	togglePanel: () => {},
};

const DiagnosticsContext = createContext<CanvasDiagnosticsContextValue | null>(null);

export function useHasDiagnosticsProvider(): boolean {
	return useContext(DiagnosticsContext) !== null;
}

export function CanvasDiagnosticsProvider({
	children,
	onOpenPanel,
	onClosePanel,
}: {
	children: ReactNode;
	onOpenPanel?: () => void;
	onClosePanel?: () => void;
}) {
	const [diagnostics, setDiagnostics] = useState<BlockDiagnostic[]>([]);
	const [isPanelOpen, setIsPanelOpen] = useState(false);
	const validatorsRef = useRef<Map<string, () => BlockDiagnostic[]>>(new Map());

	const openPanel = useCallback(() => {
		setIsPanelOpen(true);
		onOpenPanel?.();
	}, [onOpenPanel]);

	const closePanel = useCallback(() => {
		setIsPanelOpen(false);
		onClosePanel?.();
	}, [onClosePanel]);

	const togglePanel = useCallback(() => {
		setIsPanelOpen((prev) => {
			const next = !prev;
			if (next) onOpenPanel?.();
			else onClosePanel?.();
			return next;
		});
	}, [onClosePanel, onOpenPanel]);

	const byBlock = useMemo(() => {
		const map = new Map<string, BlockDiagnostic[]>();
		for (const diag of diagnostics) {
			if (!diag.blockId) continue;
			const list = map.get(diag.blockId) ?? [];
			list.push(diag);
			map.set(diag.blockId, list);
		}
		return map;
	}, [diagnostics]);

	const forBlock = useCallback(
		(blockId: string): BlockDiagnostic[] => byBlock.get(blockId) ?? [],
		[byBlock],
	);

	const highestSeverityForBlock = useCallback(
		(blockId: string): DiagnosticSeverity | null => {
			const items = byBlock.get(blockId);
			if (!items || items.length === 0) return null;
			return resolveWorstSeverity(items);
		},
		[byBlock],
	);

	const severitiesForBlock = useCallback(
		(blockId: string): BlockSeverities => {
			const items = byBlock.get(blockId) ?? [];
			let hasError = false;
			let hasWarning = false;
			let hasInfo = false;
			for (const item of items) {
				if (item.severity === "error") hasError = true;
				else if (item.severity === "warning") hasWarning = true;
				else if (item.severity === "info") hasInfo = true;
			}
			return { hasError, hasWarning, hasInfo };
		},
		[byBlock],
	);

	const worstSeverity = useMemo(() => resolveWorstSeverity(diagnostics), [diagnostics]);

	const setForBlock = useCallback((blockId: string, next: BlockDiagnostic[]) => {
		setDiagnostics((prev) => {
			const currentBlock = prev.filter((d) => d.blockId === blockId);
			if (
				currentBlock.length === next.length &&
				currentBlock.every(
					(d, i) =>
						d.source === next[i].source &&
						d.severity === next[i].severity &&
						d.message === next[i].message,
				)
			) {
				return prev;
			}
			return [...prev.filter((d) => d.blockId !== blockId), ...next];
		});
	}, []);

	const clearForBlock = useCallback((blockId: string, source?: string) => {
		setDiagnostics((prev) => {
			const remaining = prev.filter((d) => {
				if (d.blockId !== blockId) return true;
				if (source && d.source !== source) return true;
				return false;
			});
			return remaining.length === prev.length ? prev : remaining;
		});
	}, []);

	const setFromSource = useCallback((source: string, next: BlockDiagnostic[]) => {
		setDiagnostics((prev) => {
			const currentSource = prev.filter((d) => d.source === source);
			if (
				currentSource.length === next.length &&
				currentSource.every(
					(d, i) =>
						d.blockId === next[i].blockId &&
						d.severity === next[i].severity &&
						d.message === next[i].message,
				)
			) {
				return prev;
			}
			return [...prev.filter((d) => d.source !== source), ...next];
		});
	}, []);

	const clearSource = useCallback((source: string) => {
		setDiagnostics((prev) => {
			const remaining = prev.filter((d) => d.source !== source);
			return remaining.length === prev.length ? prev : remaining;
		});
	}, []);

	const clearAll = useCallback(() => {
		setDiagnostics((prev) => (prev.length === 0 ? prev : []));
	}, []);

	const registerValidator = useCallback((id: string, validator: () => BlockDiagnostic[]) => {
		validatorsRef.current.set(id, validator);
		return () => {
			validatorsRef.current.delete(id);
		};
	}, []);

	const revalidate = useCallback((): BlockDiagnostic[] => {
		const next: BlockDiagnostic[] = [];
		for (const validator of validatorsRef.current.values()) {
			next.push(...validator());
		}
		setDiagnostics((prev) => {
			if (
				prev.length === next.length &&
				prev.every(
					(d, i) =>
						d.blockId === next[i].blockId &&
						d.source === next[i].source &&
						d.severity === next[i].severity &&
						d.message === next[i].message,
				)
			) {
				return prev;
			}
			return next;
		});
		return next;
	}, []);

	const value: CanvasDiagnosticsContextValue = useMemo(
		() => ({
			all: diagnostics,
			byBlock,
			forBlock,
			highestSeverityForBlock,
			severitiesForBlock,
			worstSeverity,
			setForBlock,
			clearForBlock,
			setFromSource,
			clearSource,
			clearAll,
			revalidate,
			registerValidator,
			isPanelOpen,
			openPanel,
			closePanel,
			togglePanel,
		}),
		[
			diagnostics,
			byBlock,
			forBlock,
			highestSeverityForBlock,
			severitiesForBlock,
			worstSeverity,
			setForBlock,
			clearForBlock,
			setFromSource,
			clearSource,
			clearAll,
			revalidate,
			registerValidator,
			isPanelOpen,
			openPanel,
			closePanel,
			togglePanel,
		],
	);

	return <DiagnosticsContext.Provider value={value}>{children}</DiagnosticsContext.Provider>;
}

export function useBlockDiagnostics(): CanvasDiagnosticsContextValue {
	return useContext(DiagnosticsContext) ?? NOOP_DIAGNOSTICS;
}
