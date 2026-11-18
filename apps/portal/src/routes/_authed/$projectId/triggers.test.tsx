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
const { TriggersPage } = await import("./triggers");
const { triggersService } = await import("@/services/triggers");
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

test("pages a long list of triggers with PageFooter", async () => {
	spyOn(projectsService, "getById").mockResolvedValue({
		id: "p1",
		name: "My Project",
	} as unknown as Awaited<ReturnType<typeof projectsService.getById>>);
	spyOn(triggersService, "getPluginKinds").mockResolvedValue([]);
	const getAll = spyOn(triggersService, "getAll").mockImplementation(async (query) => {
		const page = query.page ?? 1;
		const perPage = query.perPage ?? 10;
		return {
			data: Array.from({ length: perPage }, (_, n) => ({
				id: `trig-${(page - 1) * perPage + n}`,
				name: `Trigger ${(page - 1) * perPage + n}`,
				type: "schedule",
				schedule: "0 0 * * *",
				source: null,
				active: true,
				devActive: false,
				workflows: [{ id: "wf1", name: "Nightly Digest" }],
				createdAt: "2026-01-01T00:00:00Z",
				updatedAt: "2026-01-01T00:00:00Z",
			})),
			pagination: {
				page,
				perPage,
				total: 25,
				totalPages: Math.ceil(25 / perPage),
				hasNext: page < Math.ceil(25 / perPage),
				hasPrev: page > 1,
			},
		} as unknown as Awaited<ReturnType<typeof triggersService.getAll>>;
	});

	wrap(<TriggersPage />);
	await settle();

	const body = within(document.body);
	expect(body.getByText("Trigger 0")).toBeTruthy();
	expect(body.getByText("Page 1 of 3")).toBeTruthy();
	expect(getAll).toHaveBeenCalledWith(expect.objectContaining({ page: 1, perPage: 10 }));

	fireEvent.click(body.getByRole("button", { name: "Next" }));
	await settle();

	expect(getAll).toHaveBeenCalledWith(expect.objectContaining({ page: 2, perPage: 10 }));
	expect(body.getByText("Page 2 of 3")).toBeTruthy();

	// Searching resets to page 1
	fireEvent.change(body.getByPlaceholderText("Search triggers"), {
		target: { value: "cron" },
	});
	await settle();

	expect(getAll).toHaveBeenCalledWith(
		expect.objectContaining({ page: 1, perPage: 10, search: "cron" }),
	);
});
