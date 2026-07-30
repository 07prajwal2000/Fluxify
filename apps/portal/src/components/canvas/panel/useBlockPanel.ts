import { useCallback, useMemo, useState } from "react";

export type CanvasPanel = {
	enabled: boolean;
	/** Block whose settings are on screen, `null` when the panel is closed. */
	openBlockId: string | null;
	open: (blockId: string) => void;
	close: () => void;
};

/** Which block the settings panel is showing. One at a time, by design. */
export function useBlockPanel(enabled: boolean): CanvasPanel {
	const [openBlockId, setOpenBlockId] = useState<string | null>(null);

	const open = useCallback(
		(blockId: string) => {
			if (enabled) setOpenBlockId(blockId);
		},
		[enabled],
	);

	const close = useCallback(() => setOpenBlockId(null), []);

	return useMemo(
		() => ({ enabled, openBlockId: enabled ? openBlockId : null, open, close }),
		[enabled, openBlockId, open, close],
	);
}
