import { Checkbox, Input } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import type { ConnectorFormProps } from "./types";

// S3 Compatible: AWS S3, Cloudflare R2, MinIO, or GCS through its S3 interoperability.
export function S3Form({
	projectId,
	name,
	onName,
	config,
	setField,
	hideName = false,
}: ConnectorFormProps) {
	const field = (key: string) => (config[key] as string) ?? "";

	return (
		<div className="flex flex-col gap-3.5">
			<p className="text-xs text-muted">
				Any S3-compatible bucket: Amazon S3, Cloudflare R2, MinIO, or Google Cloud Storage with HMAC
				keys.
			</p>

			{!hideName && (
				<div className="flex flex-col gap-1">
					<label htmlFor="s3-integration-name" className="text-xs font-medium text-foreground">
						Integration Name <span className="text-danger">*</span>
					</label>
					<Input
						id="s3-integration-name"
						value={name}
						onChange={(e) => onName(e.currentTarget.value)}
						placeholder="Backups | Production"
					/>
				</div>
			)}

			<AppConfigSelector
				projectId={projectId}
				value={field("bucket")}
				onChange={(v) => setField("bucket", v)}
				label="Bucket"
				placeholder="my-bucket"
			/>

			<div className="grid grid-cols-2 gap-3">
				<AppConfigSelector
					projectId={projectId}
					value={field("endpoint")}
					onChange={(v) => setField("endpoint", v)}
					label="Endpoint"
					placeholder="https://<account>.r2.cloudflarestorage.com"
				/>
				<AppConfigSelector
					projectId={projectId}
					value={field("region")}
					onChange={(v) => setField("region", v)}
					label="Region"
					placeholder="us-east-1"
				/>
			</div>
			<p className="-mt-2 text-xs text-muted">
				Leave the endpoint empty for Amazon S3. Cloudflare R2 takes the region <code>auto</code>.
			</p>

			<div className="grid grid-cols-2 gap-3">
				<AppConfigSelector
					projectId={projectId}
					value={field("accessKeyId")}
					onChange={(v) => setField("accessKeyId", v)}
					label="Access key ID"
					placeholder="cfg:S3_ACCESS_KEY_ID"
				/>
				<AppConfigSelector
					projectId={projectId}
					value={field("secretAccessKey")}
					onChange={(v) => setField("secretAccessKey", v)}
					label="Secret access key"
					placeholder="cfg:S3_SECRET_ACCESS_KEY"
				/>
			</div>
			<p className="-mt-2 text-xs text-muted">
				Keep the secret in an encrypted App Config key. The keys need list, read, write and delete
				permission on the bucket.
			</p>

			<Checkbox
				isSelected={Boolean(config.forcePathStyle)}
				onChange={(v) => setField("forcePathStyle", v)}
			>
				Use path-style URLs (needed for MinIO and most self-hosted servers)
			</Checkbox>
		</div>
	);
}
