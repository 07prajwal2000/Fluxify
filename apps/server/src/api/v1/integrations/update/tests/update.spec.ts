import {
	describe,
	it,
	expect,
	beforeEach,
	beforeAll,
	afterAll,
	mock,
	spyOn,
	type Mock,
} from "bun:test";
import { integrationRegistry } from "@fluxify/adapters/integrations";
import handleRequest from "../service";
import {
	getIntegrationById,
	updateIntegration,
	integrationExistByName,
} from "../repository";
import { getAppConfigKeys } from "../../create/repository";
import { db } from "../../../../../db";
import { publishMessage } from "../../../../../db/redis";
import { NotFoundError } from "../../../../../errors/notFoundError";
import { ConflictError } from "../../../../../errors/conflictError";
import { ServerError } from "../../../../../errors/serverError";

// Mock dependencies
mock.module("../repository", () => ({
	getIntegrationById: mock(),
	updateIntegration: mock(),
	integrationExistByName: mock(),
}));

mock.module("../../create/repository", () => ({
	getAppConfigKeys: mock(),
}));

mock.module("../../../../../db", () => ({
	db: {
		transaction: mock(),
	},
}));

mock.module("../../../../../db/redis", () => ({
	publishMessage: mock(),
}));

// spied on the shared registry, not mock.module'd: a module mock would leak into every later spec file
function stubRegistry() {
	spyOn(integrationRegistry, "require").mockReturnValue({
		configSchema: { safeParse: () => ({ success: true, data: {} }) },
	} as never);
	spyOn(integrationRegistry, "tags").mockReturnValue(["sql"]);
}

const mockGetIntegrationById = getIntegrationById as unknown as Mock<
	typeof getIntegrationById
>;
const mockUpdateIntegration = updateIntegration as unknown as Mock<
	typeof updateIntegration
>;
const mockIntegrationExistByName = integrationExistByName as unknown as Mock<
	typeof integrationExistByName
>;
const mockGetAppConfigKeys = getAppConfigKeys as unknown as Mock<
	typeof getAppConfigKeys
>;
const mockDbTransaction = db.transaction as unknown as Mock<
	typeof db.transaction
>;
const mockPublishMessage = publishMessage as unknown as Mock<
	typeof publishMessage
>;

describe("updateIntegration service", () => {
	const mockTx = {};
	const integrationId = "test-id";
	const updateData = {
		name: "updated-integration",
		config: { url: "postgres://updated" },
	};

	beforeAll(() => {
		process.env.MASTER_ENCRYPTION_KEY = Buffer.from("a".repeat(32)).toString(
			"base64",
		);
	});

	afterAll(() => mock.restore());

	beforeEach(() => {
		stubRegistry();
		mockGetIntegrationById.mockClear();
		mockUpdateIntegration.mockClear();
		mockIntegrationExistByName.mockClear();
		mockGetAppConfigKeys.mockClear();
		mockDbTransaction.mockClear();
		mockPublishMessage.mockClear();

		mockDbTransaction.mockImplementation(async (callback: any) => {
			return await callback(mockTx);
		});
		mockGetAppConfigKeys.mockResolvedValue([] as any);
	});

	it("should successfully update an integration", async () => {
		const existingIntegration = {
			id: integrationId,
			name: "old-name",
			group: "database",
			variant: "PostgreSQL",
			config: { url: "postgres://old" },
		};

		const updatedIntegration = {
			...existingIntegration,
			...updateData,
		};

		mockGetIntegrationById.mockResolvedValue(existingIntegration as any);
		mockIntegrationExistByName.mockResolvedValue({ id: integrationId } as any); // Same ID, so allowed
		mockUpdateIntegration.mockResolvedValue(updatedIntegration as any);

		const result = await handleRequest("test-project", integrationId, updateData as any);

		expect(mockGetIntegrationById).toHaveBeenCalledWith("test-project", integrationId, mockTx);
		expect(mockUpdateIntegration).toHaveBeenCalledWith(
			"test-project",
			integrationId,
			{ ...updateData, tags: ["sql"] },
			mockTx,
		);
		expect(mockPublishMessage).toHaveBeenCalled();
		expect(result).toEqual(updatedIntegration);
	});

	it("should throw NotFoundError when integration does not exist", async () => {
		mockGetIntegrationById.mockResolvedValue(null as any);

		await expect(
			handleRequest("test-project", integrationId, updateData as any),
		).rejects.toThrow(NotFoundError);
		expect(mockUpdateIntegration).not.toHaveBeenCalled();
	});

	it("should throw ConflictError when new name already exists", async () => {
		const existingIntegration = {
			id: integrationId,
			name: "old-name",
			group: "database",
			variant: "PostgreSQL",
			config: {},
		};

		mockGetIntegrationById.mockResolvedValue(existingIntegration as any);
		mockIntegrationExistByName.mockResolvedValue({ id: "different-id" } as any); // Different ID

		await expect(
			handleRequest("test-project", integrationId, updateData as any),
		).rejects.toThrow(ConflictError);
		expect(mockUpdateIntegration).not.toHaveBeenCalled();
	});

	it("should throw ServerError when update fails", async () => {
		const existingIntegration = {
			id: integrationId,
			name: "old-name",
			group: "database",
			variant: "PostgreSQL",
			config: {},
		};

		mockGetIntegrationById.mockResolvedValue(existingIntegration as any);
		mockIntegrationExistByName.mockResolvedValue(null as any); // Name not taken

		mockUpdateIntegration.mockResolvedValue(null as any);

		await expect(
			handleRequest("test-project", integrationId, updateData as any),
		).rejects.toThrow(ServerError);
	});

	it("should allow updating with same name", async () => {
		const existingIntegration = {
			id: integrationId,
			name: "same-name",
			group: "database",
			variant: "PostgreSQL",
			config: { url: "postgres://old" },
		};

		const updateDataSameName = {
			name: "same-name",
			config: { url: "postgres://updated" },
		};

		const updatedIntegration = {
			...existingIntegration,
			...updateDataSameName,
		};

		mockGetIntegrationById.mockResolvedValue(existingIntegration as any);
		mockIntegrationExistByName.mockResolvedValue({ id: integrationId } as any); // Same ID (itself)
		mockUpdateIntegration.mockResolvedValue(updatedIntegration as any);

		const result = await handleRequest(
			"test-project",
			integrationId,
			updateDataSameName as any,
		);

		expect(result).toEqual(updatedIntegration);
	});
});
