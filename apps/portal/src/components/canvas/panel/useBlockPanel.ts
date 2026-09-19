import { useCallback, useMemo, useState } from "react";

export type CanvasPanel = {
	enabled: boolean;
	/** Block whose settings are on screen, `null` when the panel is closed. */
	openBlockId: string | null;
	/** Initial tab to show when opening the panel. */
	initialTab?: string | null;
	/** Bumped on every `open`, so opening the same block and tab again still resets the tab. */
	openSeq: number;
	open: (blockId: string, initialTab?: string) => void;
	close: () => void;
};

/** Which block the settings panel is showing. One at a time, by design. */
export function useBlockPanel(enabled: boolean): CanvasPanel {
	const [openBlockId, setOpenBlockId] = useState<string | null>(null);
	const [initialTab, setInitialTab] = useState<string | null>(null);
	const [openSeq, setOpenSeq] = useState(0);

	const open = useCallback(
		(blockId: string, tab?: string) => {
			if (enabled) {
				setOpenBlockId(blockId);
				setInitialTab(tab ?? null);
				setOpenSeq((n) => n + 1);
			}
		},
		[enabled],
	);

	const close = useCallback(() => {
		setOpenBlockId(null);
		setInitialTab(null);
	}, []);

	return useMemo(
		() => ({
			enabled,
			openBlockId: enabled ? openBlockId : null,
			initialTab,
			openSeq,
			open,
			close,
		}),
		[enabled, openBlockId, initialTab, openSeq, open, close],
	);
}
