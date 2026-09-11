import { Description, Input, Label, TextField } from "@fluxify/components";
import { IntegrationField } from "./KafkaTriggerFields";
import { NoticeList } from "./TriggerNotices";
import { Counter } from "./triggerForm";

/** What an SQS trigger reads, and through which integration. */
export type SqsValues = {
	integrationId: string;
	queueUrl: string;
	waitTimeSeconds: number;
	visibilityTimeoutSec: number;
};

/** SQS never hands over more than this in one receive. */
export const SQS_MAX_BATCH = 10;

export const queueName = (url: string) => url.trim().replace(/\/+$/, "").split("/").pop() ?? "";
export const isQueueUrl = (url: string) => URL.canParse(url.trim());

export function SqsSourceFields({
	projectId,
	value,
	onChange,
}: {
	projectId: string;
	value: SqsValues;
	onChange: (next: SqsValues) => void;
}) {
	const set = <K extends keyof SqsValues>(key: K, next: SqsValues[K]) =>
		onChange({ ...value, [key]: next });

	return (
		<div className="flex flex-col gap-5">
			<IntegrationField
				projectId={projectId}
				variant="SQS"
				value={value.integrationId}
				onChange={(next) => set("integrationId", next)}
			/>

			<TextField
				isRequired
				value={value.queueUrl}
				onChange={(next) => set("queueUrl", next)}
				isInvalid={value.queueUrl.trim().length > 0 && !isQueueUrl(value.queueUrl)}
			>
				<Label>Queue URL</Label>
				<Input placeholder="https://sqs.us-east-1.amazonaws.com/123456789012/orders" />
				<Description>
					The queue must already exist; Fluxify never creates it. Saving checks it and the
					integration's credentials with AWS.
				</Description>
			</TextField>

			<div className="grid grid-cols-2 gap-4">
				<Counter
					label="Wait time (s)"
					hint="How long one request waits for messages. 20 means fewer requests, and a lower bill."
					value={value.waitTimeSeconds}
					min={0}
					max={20}
					onChange={(next) => set("waitTimeSeconds", next)}
				/>
				<Counter
					label="Visibility timeout (s)"
					hint="How long a message stays hidden while a run works on it. Set it longer than your slowest run."
					value={value.visibilityTimeoutSec}
					min={1}
					max={43_200}
					onChange={(next) => set("visibilityTimeoutSec", next)}
				/>
			</div>

			<NoticeList
				status="warning"
				title="Long polling is off"
				items={
					value.waitTimeSeconds === 0
						? ["With a wait time of 0 the trigger asks SQS for messages non-stop, and AWS bills every request."]
						: []
				}
			/>
		</div>
	);
}
