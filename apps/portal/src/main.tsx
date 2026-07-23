import { createRoot } from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import "@fluxify/components/styles.css";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/query";

const router = createRouter({
	routeTree,
	basepath: "/_/admin/ui",
	context: { queryClient },
	defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

createRoot(document.getElementById("root")!).render(
	// ponytail: StrictMode off — its double-render breaks react-aria collection
	// builders (Table/Select). Re-enable if that's ever fixed upstream.
	<QueryClientProvider client={queryClient}>
		<RouterProvider router={router} />
	</QueryClientProvider>,
);
