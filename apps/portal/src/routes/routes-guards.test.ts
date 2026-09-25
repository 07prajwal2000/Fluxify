import { describe, expect, it, mock, spyOn } from "bun:test";

const mockGetSession = mock();
mock.module("@/lib/auth", () => ({
	authClient: {
		getSession: mockGetSession,
		useSession: mock(),
		signOut: mock(),
	},
}));

import { toast } from "@fluxify/components";
import { isRedirect } from "@tanstack/react-router";
import { Route as ProjectRoute } from "./_authed/$projectId";
import { Route as RouteCanvasRoute } from "./_authed/$projectId_.canvas.$routeId";
import { Route as RouteTestSuitesRoute } from "./_authed/$projectId_.canvas.$routeId_.test-suites";
import { Route as CustomBlockCanvasRoute } from "./_authed/$projectId_.custom-block-canvas.$blockId";
import { Route as WorkflowCanvasRoute } from "./_authed/$projectId_.workflow-canvas.$workflowId";
import { Route as ConversationRoute } from "./_authed/$projectId/ai/$conversationId";
import { harnessConversationsService } from "@/services/harnessConversations";

describe("Route guards and redirects", () => {
	it("$projectId beforeLoad redirects and toasts when user has no access (403)", async () => {
		const toastSpy = spyOn(toast, "danger").mockImplementation(() => "" as any);

		const fakeQueryClient = {
			ensureQueryData: mock(async () => {
				const error: any = new Error("Forbidden");
				error.isAxiosError = true;
				error.response = {
					status: 403,
					data: { message: "You do not have access to this project" },
				};
				throw error;
			}),
		};

		let thrown: any;
		try {
			await ProjectRoute.options.beforeLoad!({
				params: { projectId: "proj-1" },
				context: { queryClient: fakeQueryClient as any },
			} as any);
		} catch (e) {
			thrown = e;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(thrown.options.to).toBe("/");
		expect(toastSpy).toHaveBeenCalledWith("You do not have access to this project");
		toastSpy.mockRestore();
	});

	it("$projectId beforeLoad redirects and toasts when project does not exist (404)", async () => {
		const toastSpy = spyOn(toast, "danger").mockImplementation(() => "" as any);

		const fakeQueryClient = {
			ensureQueryData: mock(async () => {
				const error: any = new Error("404 Not Found");
				error.isAxiosError = true;
				error.response = { status: 404, data: { message: "Project not found" } };
				throw error;
			}),
		};

		let thrown: any;
		try {
			await ProjectRoute.options.beforeLoad!({
				params: { projectId: "non-existent" },
				context: { queryClient: fakeQueryClient as any },
			} as any);
		} catch (e) {
			thrown = e;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(thrown.options.to).toBe("/");
		expect(toastSpy).toHaveBeenCalledWith("Project not found");
		toastSpy.mockRestore();
	});

	it("Route canvas beforeLoad redirects and toasts when route is not found or mismatch", async () => {
		const toastSpy = spyOn(toast, "danger").mockImplementation(() => "" as any);

		const fakeQueryClient = {
			ensureQueryData: mock(async () => ({
				id: "route-1",
				projectId: "other-project",
			})),
		};

		let thrown: any;
		try {
			await RouteCanvasRoute.options.beforeLoad!({
				params: { projectId: "my-project", routeId: "route-1" },
				context: { queryClient: fakeQueryClient as any },
			} as any);
		} catch (e) {
			thrown = e;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(thrown.options.to).toBe("/$projectId/routes");
		expect(thrown.options.params).toEqual({ projectId: "my-project" });
		expect(toastSpy).toHaveBeenCalledWith("Route not found");
		toastSpy.mockRestore();
	});

	it("Route test-suites beforeLoad redirects and toasts on route lookup failure", async () => {
		const toastSpy = spyOn(toast, "danger").mockImplementation(() => "" as any);

		const fakeQueryClient = {
			ensureQueryData: mock(async () => {
				throw new Error("Not found");
			}),
		};

		let thrown: any;
		try {
			await RouteTestSuitesRoute.options.beforeLoad!({
				params: { projectId: "my-project", routeId: "bad-route" },
				context: { queryClient: fakeQueryClient as any },
			} as any);
		} catch (e) {
			thrown = e;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(thrown.options.to).toBe("/$projectId/routes");
		expect(toastSpy).toHaveBeenCalledWith("Route not found");
		toastSpy.mockRestore();
	});

	it("Workflow canvas beforeLoad redirects and toasts when workflow mismatch", async () => {
		const toastSpy = spyOn(toast, "danger").mockImplementation(() => "" as any);

		const fakeQueryClient = {
			ensureQueryData: mock(async () => ({
				id: "wf-1",
				projectId: "diff-project",
			})),
		};

		let thrown: any;
		try {
			await WorkflowCanvasRoute.options.beforeLoad!({
				params: { projectId: "my-project", workflowId: "wf-1" },
				context: { queryClient: fakeQueryClient as any },
			} as any);
		} catch (e) {
			thrown = e;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(thrown.options.to).toBe("/$projectId/routes");
		expect(toastSpy).toHaveBeenCalledWith("Workflow not found");
		toastSpy.mockRestore();
	});

	it("Custom block canvas beforeLoad redirects and toasts when block is not found", async () => {
		const toastSpy = spyOn(toast, "danger").mockImplementation(() => "" as any);

		const fakeQueryClient = {
			ensureQueryData: mock(async () => [
				{ id: "block-1", name: "Block 1" },
			]),
		};

		let thrown: any;
		try {
			await CustomBlockCanvasRoute.options.beforeLoad!({
				params: { projectId: "my-project", blockId: "block-99" },
				context: { queryClient: fakeQueryClient as any },
			} as any);
		} catch (e) {
			thrown = e;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(thrown.options.to).toBe("/$projectId/routes");
		expect(toastSpy).toHaveBeenCalledWith("Custom block not found");
		toastSpy.mockRestore();
	});

	it("AI conversation beforeLoad redirects and toasts when listMessages fails", async () => {
		const toastSpy = spyOn(toast, "danger").mockImplementation(() => "" as any);
		spyOn(harnessConversationsService, "listMessages").mockRejectedValue(
			new Error("Conversation not found"),
		);

		let thrown: any;
		try {
			await ConversationRoute.options.beforeLoad!({
				params: { projectId: "my-project", conversationId: "conv-1" },
			} as any);
		} catch (e) {
			thrown = e;
		}

		expect(isRedirect(thrown)).toBe(true);
		expect(thrown.options.to).toBe("/$projectId/routes");
		expect(toastSpy).toHaveBeenCalledWith("Conversation not found");
		toastSpy.mockRestore();
	});
});
