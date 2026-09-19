import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import "@fluxify/components/styles.css";
import { BASE_PATH } from "./constants/routes";
import { queryClient } from "./lib/query";
import { initTheme } from "./lib/theme";
import { routeTree } from "./routeTree.gen";

initTheme();

const router = createRouter({
	routeTree,
	basepath: BASE_PATH,
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
