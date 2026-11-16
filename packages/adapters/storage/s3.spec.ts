import { describe, expect, it } from "bun:test";
import { builtInVariantMeta } from "../integrations/builtinVariants";
import { s3VariantConfigSchema } from "../integrations/schemas";
import { describeS3Error, isMissingKey, testS3Connection } from "./s3";

const base = { bucket: "b", accessKeyId: "cfg:KEY", secretAccessKey: "cfg:SECRET" };
const s3Error = (code: string) => Object.assign(new Error(`S3 said ${code}`), { code });

describe("s3VariantConfigSchema", () => {
	it("fills the defaults: AWS endpoint, us-east-1, virtual-hosted style", () => {
		expect(s3VariantConfigSchema.parse(base)).toEqual({
			...base,
			endpoint: "",
			region: "us-east-1",
			forcePathStyle: false,
		});
	});

	it("takes an http(s) endpoint or a cfg: reference, and refuses anything else", () => {
		for (const endpoint of ["https://acct.r2.cloudflarestorage.com", "http://minio:9000", "cfg:S3_URL"])
			expect(s3VariantConfigSchema.safeParse({ ...base, endpoint }).success).toBe(true);
		expect(s3VariantConfigSchema.safeParse({ ...base, endpoint: "minio:9000" }).success).toBe(false);
	});

	it("needs a bucket and both keys", () => {
		for (const field of ["bucket", "accessKeyId", "secretAccessKey"])
			expect(s3VariantConfigSchema.safeParse({ ...base, [field]: "" }).success).toBe(false);
	});

	it("is registered as the storage group's S3 Compatible variant", () => {
		expect(builtInVariantMeta("storage", "S3 Compatible")?.configSchema).toBe(
			s3VariantConfigSchema,
		);
	});
});

describe("describeS3Error", () => {
	const config = { bucket: "backups", endpoint: "http://minio:9000" };

	it("names the keys for every credential error", () => {
		for (const code of ["InvalidAccessKeyId", "SignatureDoesNotMatch", "ExpiredToken"])
			expect(describeS3Error(s3Error(code), config)).toContain("was refused");
	});

	it("tells a permission problem apart from bad keys", () => {
		expect(describeS3Error(s3Error("AccessDenied"), config)).toContain('not allowed to use bucket "backups"');
	});

	it("names a missing bucket", () => {
		expect(describeS3Error(s3Error("NoSuchBucket"), config)).toBe('Bucket "backups" does not exist.');
	});

	it("blames the endpoint for network errors, and AWS when there is none", () => {
		expect(describeS3Error(s3Error("ConnectionRefused"), config)).toContain("Could not reach http://minio:9000");
		expect(describeS3Error(s3Error("ENOTFOUND"), { bucket: "b", endpoint: "" })).toContain("Could not reach AWS S3");
		expect(describeS3Error(new Error("boom"), config)).toContain("Could not reach");
	});

	it("passes any other S3 error through", () => {
		expect(describeS3Error(s3Error("SlowDown"), config)).toBe("S3 said SlowDown");
	});
});

describe("isMissingKey", () => {
	it("is true only for no-such-key", () => {
		expect(isMissingKey(s3Error("NoSuchKey"))).toBe(true);
		expect(isMissingKey(s3Error("NoSuchBucket"))).toBe(false);
		expect(isMissingKey(null)).toBe(false);
	});
});

describe("testS3Connection", () => {
	it("reports a config problem without calling S3", async () => {
		expect(await testS3Connection({ ...base, bucket: "" })).toEqual({
			success: false,
			error: "Bucket is required",
		});
	});
});
