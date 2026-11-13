import type {
	IntegrationTestResult,
	ListObjectsOptions,
	ObjectStorageAdapter,
	PutObjectOptions,
	StoredObject,
	StoredObjectPage,
} from "@fluxify/sdk/integrations";
import { S3Client } from "bun";
import type z from "zod";
import { s3VariantConfigSchema } from "../integrations/schemas";

/** An S3 Compatible integration's config, `cfg:` references already expanded. */
export type S3Config = z.input<typeof s3VariantConfigSchema>;

/**
 * Size of one multipart part, and so the threshold: a body larger than this is
 * uploaded in parts. 5 MiB is S3's smallest allowed part.
 */
export const S3_PART_SIZE = 5 * 1024 * 1024;

/** S3's own error codes, grouped by what the user has to fix. */
const CREDENTIAL_CODES = new Set([
	"InvalidAccessKeyId",
	"SignatureDoesNotMatch",
	"InvalidToken",
	"ExpiredToken",
]);
const NOT_FOUND_CODES = new Set(["NoSuchKey", "NotFound"]);

const codeOf = (error: unknown) => (error as { code?: string } | null)?.code ?? "";

/** True when S3 answered "no such key". */
export function isMissingKey(error: unknown) {
	return NOT_FOUND_CODES.has(codeOf(error));
}

/** A failure turned into what the user has to fix: credentials, bucket or endpoint. */
export function describeS3Error(error: unknown, config: Pick<S3Config, "bucket" | "endpoint">) {
	const code = codeOf(error);
	if (CREDENTIAL_CODES.has(code))
		return "The access key ID or secret access key was refused. Check both.";
	if (code === "AccessDenied")
		return `The keys were accepted but are not allowed to use bucket "${config.bucket}". Give them list, read, write and delete permission on it.`;
	if (code === "NoSuchBucket") return `Bucket "${config.bucket}" does not exist.`;
	if (code === "PermanentRedirect" || code === "AuthorizationHeaderMalformed")
		return `Bucket "${config.bucket}" is in a different region. Set the bucket's region.`;
	if (!code.length || /^(E[A-Z]+|ConnectionRefused|ConnectionClosed|FailedToOpenSocket)/.test(code))
		return `Could not reach ${config.endpoint || "AWS S3"}. Check the endpoint.`;
	return error instanceof Error && error.message ? error.message : `S3 error ${code}`;
}

/**
 * An S3-compatible bucket, through Bun's own S3 client: no SDK. One client per
 * integration; the factory or caller keeps the instance, so requests reuse its
 * keep-alive connections.
 */
export class S3Storage implements ObjectStorageAdapter {
	readonly client: S3Client;

	constructor(config: S3Config) {
		const c = s3VariantConfigSchema.parse(config);
		this.client = new S3Client({
			bucket: c.bucket,
			region: c.region || "us-east-1",
			accessKeyId: c.accessKeyId,
			secretAccessKey: c.secretAccessKey,
			...(c.endpoint && { endpoint: c.endpoint }),
			// Bun defaults to path style; AWS wants virtual-hosted style
			virtualHostedStyle: !c.forcePathStyle,
		});
	}

	async put(
		key: string,
		body: Uint8Array | ReadableStream<Uint8Array>,
		options: PutObjectOptions = {},
	) {
		// a stream has no length, so it always goes up through the multipart writer
		if (body instanceof Uint8Array && body.byteLength <= S3_PART_SIZE) {
			await this.client.write(key, body, { type: options.contentType });
			return;
		}
		const writer = this.client.file(key).writer({
			type: options.contentType,
			partSize: S3_PART_SIZE,
			retry: 3,
		});
		try {
			if (body instanceof Uint8Array) writer.write(body);
			else for await (const chunk of body) await writer.write(chunk);
			await writer.end();
		} catch (error) {
			// ends the writer, which aborts the multipart upload
			await Promise.resolve(writer.end(error as Error)).catch(() => {});
			throw error;
		}
	}

	async get(key: string) {
		// a missing key only shows on the first read of a stream, so ask first
		if (!(await this.head(key))) return null;
		return this.client.file(key).stream() as ReadableStream<Uint8Array>;
	}

	async head(key: string): Promise<StoredObject | null> {
		try {
			const stat = await this.client.stat(key);
			return { key, size: stat.size, lastModified: stat.lastModified };
		} catch (error) {
			if (isMissingKey(error)) return null;
			throw error;
		}
	}

	async list(prefix: string, options: ListObjectsOptions = {}): Promise<StoredObjectPage> {
		const page = await this.client.list({
			prefix,
			maxKeys: options.limit,
			continuationToken: options.cursor,
		});
		return {
			objects: (page.contents ?? []).map((o) => ({
				key: o.key,
				size: o.size ?? 0,
				lastModified: new Date(o.lastModified ?? 0),
			})),
			...(page.isTruncated && page.nextContinuationToken && { cursor: page.nextContinuationToken }),
		};
	}

	async delete(key: string) {
		await this.client.delete(key);
	}
}

/** Lists one key: proves the endpoint, the keys and the bucket in one request. */
export async function testS3Connection(config: S3Config): Promise<IntegrationTestResult> {
	const parsed = s3VariantConfigSchema.safeParse(config);
	if (!parsed.success) return { success: false, error: parsed.error.issues[0]!.message };
	try {
		await new S3Storage(parsed.data).client.list({ maxKeys: 1 });
		return { success: true, error: "" };
	} catch (error) {
		return { success: false, error: describeS3Error(error, config) };
	}
}
