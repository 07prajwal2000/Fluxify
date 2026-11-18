import { afterAll, afterEach, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

try {
	GlobalRegistrator.register({ url: "http://localhost:5601/" });
} catch {}

const navigate = mock();
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	useNavigate: () => navigate,
	createFileRoute: () => (config: Record<string, unknown>) => ({
		...config,
		useParams: () => ({ projectId: "p1" }),
	}),
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MiddlewaresPage } = await import("./middlewares");
const { middlewaresService } = await import("@/services/middlewares");
const { projectsService } = await import("@/services/projects");

afterEach(() => {
	cleanup();
	navigate.mockClear();
	localStorage.clear();
});
afterAll(() => GlobalRegistrator.unregister());

const wrap = (node: ReactNode) =>
	render(
		<QueryClientProvider
			client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
		>
			{node}
		</QueryClientProvider>,
	);

const settle = () => act(async () => new Promise((r) => setTimeout(r, 60)));

test("pages a long list of middlewares in the browser with PageFooter", async () => {
	spyOn(projectsService, "getById").mockResolvedValue({
		id: "p1",
		name: "My Project",
	} as unknown as Awaited<ReturnType<typeof projectsService.getById>>);
	spyOn(middlewaresService, "getAll").mockResolvedValue(
		Array.from({ length: 25 }, (_, n) => ({
			id: `mid-${n}`,
			name: `Middleware ${n}`,
			description: `Description ${n}`,
			updatedAt: "2026-01-01T00:00:00Z",
			blocks: [],
			routeCount: 0,
		})),
	);

	wrap(<MiddlewaresPage />);
	await settle();

	const body = within(document.body);
	expect(body.getByText("Middleware 0")).toBeTruthy();
	expect(body.getByText("Middleware 9")).toBeTruthy();
	expect(body.queryByText("Middleware 10")).toBeNull();
	expect(body.getByText("Page 1 of 3")).toBeTruthy();

	fireEvent.click(body.getByRole("button", { name: "Next" }));
	await settle();

	expect(body.getByText("Middleware 10")).toBeTruthy();
	expect(body.queryByText("Middleware 0")).toBeNull();
	expect(body.getByText("Page 2 of 3")).toBeTruthy();

	// Searching resets to page 1
	fireEvent.change(body.getByPlaceholderText("Search middlewares"), {
		target: { value: "Middleware 2" },
	});
	await settle();

	expect(body.getByText("Middleware 2")).toBeTruthy();
	expect(body.queryByText("Middleware 0")).toBeNull();
	expect(body.queryByText("Page 2 of 3")).toBeNull();
});
