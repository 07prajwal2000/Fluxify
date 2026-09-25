import { useEffect, useState } from "react";
import {
	CanvasSpotlight,
	KeyboardShortcutsModal,
	matchCombo,
	useSpotlightCommands,
} from "@/components/canvas";

/** the spotlight (mod+k) and shortcuts modal of a tests page, route or workflow */
export function TestsSpotlight() {
	const [spotlightOpen, setSpotlightOpen] = useState(false);
	const [shortcutsOpen, setShortcutsOpen] = useState(false);
	const spotlightCommands = useSpotlightCommands({
		actions: [],
		onOpenShortcuts: () => setShortcutsOpen(true),
		onClose: () => setSpotlightOpen(false),
	});

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (matchCombo(e, "mod+k") || matchCombo(e, "mod+space")) {
				e.preventDefault();
				setSpotlightOpen((open) => !open);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	return (
		<>
			<CanvasSpotlight
				isOpen={spotlightOpen}
				onOpenChange={setSpotlightOpen}
				commands={spotlightCommands}
			/>
			<KeyboardShortcutsModal isOpen={shortcutsOpen} onOpenChange={setShortcutsOpen} />
		</>
	);
}
