import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as reactQuery from "@tanstack/react-query";
import * as router from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { projectsQuery } from "@/query/projectsQuery";
import * as authStore from "@/store/auth";
import { ProjectsTab } from "./ProjectsTab";

describe("ProjectsTab", () => {
	beforeEach(() => {
		spyOn(router, "useNavigate").mockReturnValue((async () => {}) as any);
		spyOn(reactQuery, "useQueryClient").mockReturnValue({
			invalidateQueries: () => {},
		} as any);
	});

	it("renders EmptyState with Create project button when admin has zero projects", () => {
		spyOn(authStore, "useAuthStore").mockReturnValue({
			userData: { isSystemAdmin: true } as any,
		} as any);

		spyOn(projectsQuery.getAll, "useQuery").mockReturnValue({
			data: { data: [], pagination: { hasNext: false, page: 1, totalPages: 1 } },
			isLoading: false,
			isError: false,
		} as any);

		const html = renderToStaticMarkup(<ProjectsTab />);
		expect(html).toContain("No projects yet");
		expect(html).toContain("Create project");
		expect(html).toContain("border-dashed");
	});

	it("renders plain no projects message when non-admin has zero projects", () => {
		spyOn(authStore, "useAuthStore").mockReturnValue({
			userData: { isSystemAdmin: false } as any,
		} as any);

		spyOn(projectsQuery.getAll, "useQuery").mockReturnValue({
			data: { data: [], pagination: { hasNext: false, page: 1, totalPages: 1 } },
			isLoading: false,
			isError: false,
		} as any);

		const html = renderToStaticMarkup(<ProjectsTab />);
		expect(html).toContain("No projects found.");
		expect(html).not.toContain("border-dashed");
		expect(html).not.toContain("Create project");
	});

	it("renders project cards when projects exist", () => {
		spyOn(authStore, "useAuthStore").mockReturnValue({
			userData: { isSystemAdmin: true } as any,
		} as any);

		spyOn(projectsQuery.getAll, "useQuery").mockReturnValue({
			data: {
				data: [
					{
						id: "p1",
						name: "Alpha Project",
						description: "Alpha desc",
						totalUsers: 2,
						totalRoutes: 5,
						updatedAt: new Date().toISOString(),
						createdAt: new Date().toISOString(),
					},
				],
				pagination: { hasNext: false, page: 1, totalPages: 1 },
			},
			isLoading: false,
			isError: false,
		} as any);

		const html = renderToStaticMarkup(<ProjectsTab />);
		expect(html).toContain("Alpha Project");
		expect(html).toContain("Alpha desc");
		expect(html).not.toContain("No projects yet");
		expect(html).not.toContain("No projects found.");
	});
});
