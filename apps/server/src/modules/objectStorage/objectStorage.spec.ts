import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import * as repository from "../../api/v1/integrations/test-existing-connection/repository";
import { openObjectStorage } from ".";

const config = {
	endpoint: "http://minio:9000",
	region: "us-east-1",
	bucket: "backups",
	accessKeyId: "key",
	secretAccessKey: "secret",
	forcePathStyle: true,
};
const row = (over: Record<string, unknown> = {}) =>
	({
		id: "s1",
		projectId: "p",
		name: "Backups",
		group: "storage",
		variant: "S3 Compatible",
		config,
		devConfig: null,
		syncDev: false,
		...over,
	}) as never;
const serve = (value: unknown) => spyOn(repository, "getIntegrationById").mockResolvedValue(value as never);

afterEach(() => mock.restore());

describe("openObjectStorage", () => {
	it("reuses the client while the config is unchanged, and replaces it when it changes", async () => {
		serve(row());
		const first = await openObjectStorage("p", "s1");
		expect(await openObjectStorage("p", "s1")).toBe(first);

		serve(row({ config: { ...config, secretAccessKey: "rotated" } }));
		expect(await openObjectStorage("p", "s1")).not.toBe(first);
	});

	it("keeps production and development apart", async () => {
		serve(row({ id: "s2", syncDev: true }));
		expect(await openObjectStorage("p", "s2", "development")).not.toBe(
			await openObjectStorage("p", "s2", "production"),
		);
	});

	it("refuses a missing integration and one of another group", async () => {
		serve(undefined);
		await expect(openObjectStorage("p", "nope")).rejects.toThrow("not found");
		serve(row({ group: "kv", variant: "Redis" }));
		await expect(openObjectStorage("p", "s1")).rejects.toThrow("not an Object Storage integration");
	});

	it("refuses development when it has no config of its own", async () => {
		serve(row({ id: "s3" }));
		await expect(openObjectStorage("p", "s3", "development")).rejects.toThrow();
	});
});
