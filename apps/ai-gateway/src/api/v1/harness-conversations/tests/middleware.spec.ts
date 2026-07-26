import { describe, it, expect, spyOn, mock, afterEach } from "bun:test";
import { verifyHarnessConversationOwner, verifyProjectAccess } from "../middleware";
import * as repository from "../repository";
import * as serverModule from "@fluxify/server";

describe("Harness Conversation Owner Middleware", () => {
	afterEach(() => {
		mock.restore();
	});

	const getMockContext = (
		params: { conversationId?: string; projectId?: string } = {},
		user: any = {},
	) => ({
		get: mock().mockImplementation((key) => (key === "user" ? user : undefined)),
		set: mock(),
		req: {
			param: mock().mockImplementation((key: string) => (params as any)[key]),
		},
	});

	it("throws NotFoundError when conversationId param is missing", async () => {
		const ctx = getMockContext({ projectId: "proj1" }) as any;
		expect(verifyHarnessConversationOwner(ctx, mock())).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws NotFoundError when the conversation does not exist", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue(undefined as any);
		const ctx = getMockContext({ conversationId: "conv1", projectId: "proj1" }) as any;
		expect(verifyHarnessConversationOwner(ctx, mock())).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws NotFoundError when the conversation belongs to a different project", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "owner",
			projectId: "proj-other",
		} as any);
		const ctx = getMockContext(
			{ conversationId: "conv1", projectId: "proj1" },
			{ id: "owner", isSystemAdmin: false },
		) as any;
		expect(verifyHarnessConversationOwner(ctx, mock())).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws ForbiddenError when a non-admin, non-owner accesses the conversation", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "owner",
			projectId: "proj1",
		} as any);
		const ctx = getMockContext(
			{ conversationId: "conv1", projectId: "proj1" },
			{ id: "other", isSystemAdmin: false },
		) as any;
		expect(verifyHarnessConversationOwner(ctx, mock())).rejects.toThrow(serverModule.ForbiddenError);
	});

	it("allows a system admin to access any conversation", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({
			id: "conv1",
			userId: "owner",
			projectId: "proj1",
		} as any);
		const ctx = getMockContext(
			{ conversationId: "conv1", projectId: "proj1" },
			{ id: "admin", isSystemAdmin: true },
		) as any;
		const next = mock();

		await verifyHarnessConversationOwner(ctx, next);
		expect(next).toHaveBeenCalled();
	});

	it("calls next and sets the conversation on success", async () => {
		const conversation = { id: "conv1", userId: "owner", projectId: "proj1" };
		spyOn(repository, "getConversationById").mockResolvedValue(conversation as any);
		const ctx = getMockContext(
			{ conversationId: "conv1", projectId: "proj1" },
			{ id: "owner", isSystemAdmin: false },
		) as any;
		const next = mock();

		await verifyHarnessConversationOwner(ctx, next);
		expect(ctx.set).toHaveBeenCalledWith("conversation", conversation);
		expect(next).toHaveBeenCalled();
	});
});

describe("Harness Conversation Project Access Middleware", () => {
	afterEach(() => {
		mock.restore();
	});

	const getMockContext = (projectId?: string, user: any = {}, acl: any = []) => ({
		get: mock().mockImplementation((key) => {
			if (key === "user") return user;
			if (key === "acl") return acl;
		}),
		req: {
			param: mock().mockImplementation((key: string) => (key === "projectId" ? projectId : undefined)),
		},
	});

	it("throws BadRequestError when projectId param is missing", async () => {
		const ctx = getMockContext(undefined) as any;
		expect(verifyProjectAccess("viewer")(ctx, mock())).rejects.toThrow(serverModule.BadRequestError);
	});

	it("throws ForbiddenError when the user lacks the required project access", async () => {
		spyOn(serverModule, "hasProjectAccess").mockReturnValue(false);
		const ctx = getMockContext("proj1") as any;
		expect(verifyProjectAccess("creator")(ctx, mock())).rejects.toThrow(serverModule.ForbiddenError);
	});

	it("calls next on success", async () => {
		spyOn(serverModule, "hasProjectAccess").mockReturnValue(true);
		const ctx = getMockContext("proj1") as any;
		const next = mock();

		await verifyProjectAccess("viewer")(ctx, next);
		expect(next).toHaveBeenCalled();
	});
});
