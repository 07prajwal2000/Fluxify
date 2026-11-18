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
		useSearch: () => ({ q: undefined }),
	}),
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { AppConfigPage } = await import("./app-config");
const { appConfigService } = await import("@/services/appConfig");
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

test("pages app config with remembered PageFooter size", async () => {
	spyOn(projectsService, "getById").mockResolvedValue({
		id: "p1",
		name: "My Project",
	} as unknown as Awaited<ReturnType<typeof projectsService.getById>>);
	const getAll = spyOn(appConfigService, "getAll").mockImplementation(async (_pid, query) => {
		const page = query.page ?? 1;
		const perPage = query.perPage ?? 20;
		return {
			data: Array.from({ length: perPage }, (_, n) => ({
				id: (page - 1) * perPage + n + 1,
				keyName: `KEY_${(page - 1) * perPage + n + 1}`,
				value: "val",
				isEncrypted: false,
				encodingType: "plain",
				createdAt: "2026-01-01T00:00:00Z",
				updatedAt: "2026-01-01T00:00:00Z",
			})),
			pagination: {
				page,
				perPage,
				total: 45,
				totalPages: Math.ceil(45 / perPage),
				hasNext: page < Math.ceil(45 / perPage),
				hasPrev: page > 1,
			},
		} as unknown as Awaited<ReturnType<typeof appConfigService.getAll>>;
	});

	wrap(<AppConfigPage />);
	await settle();

	const body = within(document.body);
	expect(body.getByText("KEY_1")).toBeTruthy();
	expect(body.getByText("Page 1 of 3")).toBeTruthy();
	expect(getAll).toHaveBeenCalledWith("p1", expect.objectContaining({ page: 1, perPage: 20 }));

	fireEvent.click(body.getByRole("button", { name: "Next" }));
	await settle();

	expect(getAll).toHaveBeenCalledWith("p1", expect.objectContaining({ page: 2, perPage: 20 }));
	expect(body.getByText("Page 2 of 3")).toBeTruthy();
});
