import { createFileRoute } from "@tanstack/react-router";
import { TestSuitesWorkbench } from "@/components/testSuites/TestSuitesWorkbench";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId_/test-suites")({
	head: createRouteHead("Route Tests", "Create, edit and run test suites for an API route."),
	component: TestSuitesPage,
});

function TestSuitesPage() {
	const { projectId, routeId } = Route.useParams();

	// The workbench owns the topbar: the run controls and the suite count live
	// there alongside the route switcher and the canvas/tests tabs.
	return (
		<div className="flex h-screen w-full flex-col">
			<TestSuitesWorkbench projectId={projectId} routeId={routeId} />
		</div>
	);
}
