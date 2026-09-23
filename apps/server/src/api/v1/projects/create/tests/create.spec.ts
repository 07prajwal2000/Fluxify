import { beforeEach, describe, expect, it, mock } from "bun:test";
import handleRequest from "../service";
import * as repository from "../repository";
import * as membersRepository from "../../settings/members/repository";
import * as settingsRepository from "../../settings/keys/upsert/repository";
import * as redis from "../../../../../db/redis";
import { ConflictError } from "../../../../../errors/conflictError";

mock.module("../repository", () => ({
	createProject: mock(),
	checkProjectExists: mock(),
	isSlugTaken: mock(),
}));

mock.module("../../settings/members/repository", () => ({
	addProjectMember: mock(),
}));

mock.module("../../settings/keys/upsert/repository", () => ({
	upsertProjectSettingKey: mock(),
}));

const redisModule = { ...(await import("../../../../../db/redis")) };
mock.module("../../../../../db/redis", () => ({
	...redisModule,
	publishMessage: mock(),
}));

const tx = { __tx: true };
mock.module("../../../../../db", () => ({
	db: { transaction: (fn: (t: unknown) => unknown) => fn(tx) },
}));

describe("create project service", () => {
	beforeEach(() => {
		(repository.createProject as any).mockClear();
		(repository.checkProjectExists as any).mockClear();
		(membersRepository.addProjectMember as any).mockClear();
		(settingsRepository.upsertProjectSettingKey as any).mockClear();
		(redis.publishMessage as any).mockClear();
		(repository.checkProjectExists as any).mockResolvedValue(false);
		(repository.createProject as any).mockResolvedValue("proj-1");
		(repository.isSlugTaken as any).mockResolvedValue(false);
	});

	it("slugs the name when no slug is given, and keeps a given one", async () => {
		await handleRequest({ name: "Billing API" } as any);
		expect((repository.createProject as any).mock.calls[0][0].slug).toBe("billing-api");
		await handleRequest({ name: "Billing API", slug: "pay" } as any);
		expect((repository.createProject as any).mock.calls[1][0].slug).toBe("pay");
	});

	it("rejects a slug that is taken", async () => {
		(repository.isSlugTaken as any).mockResolvedValue(true);
		expect(handleRequest({ name: "Billing" } as any)).rejects.toThrow(ConflictError);
	});

	it("rejects a duplicate name by name, not by id", async () => {
		(repository.checkProjectExists as any).mockResolvedValue(true);

		expect(handleRequest({ name: "Billing" } as any)).rejects.toThrow(
			ConflictError,
		);
		expect(repository.checkProjectExists).toHaveBeenCalledWith("Billing", tx);
	});

	it("writes members and settings in the creating transaction", async () => {
		const result = await handleRequest({
			name: "Billing",
			members: [
				{ userId: "u1", role: "viewer" },
				{ userId: "u2", role: "project_admin" },
			],
			settings: { "experimental.workerTimeouts.enabled": "true" },
		} as any);

		expect(result).toEqual({ id: "proj-1" });
		// Same `tx` as the insert — a failure anywhere rolls the project back.
		expect(membersRepository.addProjectMember).toHaveBeenCalledWith(
			"proj-1",
			"u1",
			"viewer",
			tx,
		);
		expect(membersRepository.addProjectMember).toHaveBeenCalledWith(
			"proj-1",
			"u2",
			"project_admin",
			tx,
		);
		expect(settingsRepository.upsertProjectSettingKey).toHaveBeenCalledWith(
			"proj-1",
			"experimental.workerTimeouts.enabled",
			"true",
			tx,
		);
		// the compiler reloads settings on this, so a subdomain reaches the workers
		expect(redis.publishMessage).toHaveBeenCalledWith(
			redis.CHAN_ON_PROJECT_SETTING_CHANGE,
			"proj-1",
		);
	});

	it("creates a bare project when members and settings are omitted", async () => {
		await handleRequest({ name: "Billing" } as any);

		expect(membersRepository.addProjectMember).not.toHaveBeenCalled();
		expect(settingsRepository.upsertProjectSettingKey).not.toHaveBeenCalled();
		expect(redis.publishMessage).not.toHaveBeenCalled();
		// `members`/`settings` must not reach the insert — they are not columns.
		const [inserted] = (repository.createProject as any).mock.calls[0];
		expect(inserted).not.toHaveProperty("members");
		expect(inserted).not.toHaveProperty("settings");
	});
});
