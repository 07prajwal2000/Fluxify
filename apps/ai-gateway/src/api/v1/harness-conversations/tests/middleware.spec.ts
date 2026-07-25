import { describe, it, expect, spyOn, mock, afterEach } from "bun:test";
import { verifyHarnessConversationOwner } from "../middleware";
import * as repository from "../repository";
import * as serverModule from "@fluxify/server";

describe("Harness Conversation Owner Middleware", () => {
	afterEach(() => {
		mock.restore();
	});

	const getMockContext = (conversationId?: string, user: any = {}) => ({
		get: mock().mockImplementation((key) => (key === "user" ? user : undefined)),
		set: mock(),
		req: {
			param: mock().mockImplementation((key) => (key === "conversationId" ? conversationId : undefined)),
		},
	});

	it("throws NotFoundError when conversationId param is missing", async () => {
		const ctx = getMockContext(undefined) as any;
		expect(verifyHarnessConversationOwner(ctx, mock())).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws NotFoundError when the conversation does not exist", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue(undefined as any);
		const ctx = getMockContext("conv1") as any;
		expect(verifyHarnessConversationOwner(ctx, mock())).rejects.toThrow(serverModule.NotFoundError);
	});

	it("throws ForbiddenError when a non-admin, non-owner accesses the conversation", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({ id: "conv1", userId: "owner" } as any);
		const ctx = getMockContext("conv1", { id: "other", isSystemAdmin: false }) as any;
		expect(verifyHarnessConversationOwner(ctx, mock())).rejects.toThrow(serverModule.ForbiddenError);
	});

	it("allows a system admin to access any conversation", async () => {
		spyOn(repository, "getConversationById").mockResolvedValue({ id: "conv1", userId: "owner" } as any);
		const ctx = getMockContext("conv1", { id: "admin", isSystemAdmin: true }) as any;
		const next = mock();

		await verifyHarnessConversationOwner(ctx, next);
		expect(next).toHaveBeenCalled();
	});

	it("calls next and sets the conversation on success", async () => {
		const conversation = { id: "conv1", userId: "owner" };
		spyOn(repository, "getConversationById").mockResolvedValue(conversation as any);
		const ctx = getMockContext("conv1", { id: "owner", isSystemAdmin: false }) as any;
		const next = mock();

		await verifyHarnessConversationOwner(ctx, next);
		expect(ctx.set).toHaveBeenCalledWith("conversation", conversation);
		expect(next).toHaveBeenCalled();
	});
});
