import { Input } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import type { ConnectorFormProps } from "./types";

// SQS: a region and, optionally, keys. No dead-letter field: AWS handles that.
export function SqsForm({ projectId, name, onName, config, setField }: ConnectorFormProps) {
	const field = (key: string) => (config[key] as string) ?? "";

	return (
		<div className="flex flex-col gap-3.5">
			<p className="text-xs text-muted">
				Connects to Amazon SQS. Failed messages are handled by the queue's own dead-letter queue
				(its redrive policy) in AWS, not by Fluxify.
			</p>

			<div className="flex flex-col gap-1">
				<label className="text-xs font-medium text-foreground">
					Integration Name <span className="text-danger">*</span>
				</label>
				<Input value={name} onChange={(e) => onName(e.currentTarget.value)} placeholder="SQS | Production" />
			</div>

			<AppConfigSelector
				projectId={projectId}
				value={field("region")}
				onChange={(v) => setField("region", v)}
				label="Region"
				placeholder="us-east-1"
			/>

			<div className="grid grid-cols-2 gap-3">
				<AppConfigSelector
					projectId={projectId}
					value={field("accessKeyId")}
					onChange={(v) => setField("accessKeyId", v)}
					label="Access key ID"
					placeholder="cfg:AWS_ACCESS_KEY_ID"
				/>
				<AppConfigSelector
					projectId={projectId}
					value={field("secretAccessKey")}
					onChange={(v) => setField("secretAccessKey", v)}
					label="Secret access key"
					placeholder="cfg:AWS_SECRET_ACCESS_KEY"
				/>
			</div>
			<p className="-mt-2 text-xs text-muted">
				Leave both empty to use the server's own AWS credentials, such as an IAM role. The keys need
				sqs:GetQueueAttributes, ReceiveMessage, DeleteMessage and ChangeMessageVisibility.
			</p>

			<details className="rounded-lg border border-border px-3 py-2">
				<summary className="cursor-pointer text-xs font-medium text-foreground">Advanced</summary>
				<div className="flex flex-col gap-3 pt-3">
					<AppConfigSelector
						projectId={projectId}
						value={field("sessionToken")}
						onChange={(v) => setField("sessionToken", v)}
						label="Session token"
						description="Only for temporary credentials. They expire, and the trigger stops reading when they do."
						placeholder="cfg:AWS_SESSION_TOKEN"
					/>
					<AppConfigSelector
						projectId={projectId}
						value={field("endpoint")}
						onChange={(v) => setField("endpoint", v)}
						label="Endpoint"
						description="An SQS-compatible endpoint, such as a local emulator. Leave empty for AWS."
						placeholder="http://localhost:4566"
					/>
				</div>
			</details>
		</div>
	);
}
