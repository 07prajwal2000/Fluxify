import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
	CanvasSpotlight,
	KeyboardShortcutsModal,
	matchCombo,
	useSpotlightCommands,
} from "@/components/canvas";
import { TestSuitesWorkbench } from "@/components/testSuites/TestSuitesWorkbench";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId_/test-suites")({
	head: createRouteHead("Route Tests", "Create, edit and run test suites for an API route."),
	component: TestSuitesPage,
});

function TestSuitesPage() {
	const { projectId, routeId } = Route.useParams();
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

	// The workbench owns the topbar: the run controls and the suite count live
	// there alongside the route switcher and the canvas/tests tabs.
	return (
		<div className="flex h-screen w-full flex-col">
			<TestSuitesWorkbench projectId={projectId} routeId={routeId} />
			<CanvasSpotlight
				isOpen={spotlightOpen}
				onOpenChange={setSpotlightOpen}
				commands={spotlightCommands}
			/>
			<KeyboardShortcutsModal
				isOpen={shortcutsOpen}
				onOpenChange={setShortcutsOpen}
			/>
		</div>
	);
}
