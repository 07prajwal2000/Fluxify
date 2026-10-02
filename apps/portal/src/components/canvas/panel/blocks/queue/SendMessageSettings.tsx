import {
	Button,
	Description,
	JavaScriptTextArea,
	type JsonArray,
	JsonEditor,
	type JsonObject,
	JsTextField,
	Label,
	usePackageTypes,
} from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { TbCode } from "react-icons/tb";
import { integrationsQuery } from "@/query/integrationsQuery";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import type { BlockData, BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import {
	BlockCheckboxField,
	BlockIntegrationField,
	BlockJsTextField,
	BlockSelectField,
} from "../../fields";
import { HeadersEditor } from "../HttpRequestSettings";

type OptionInfo = { name: string; label: string; hint: string; placeholder?: string };

type BrokerInfo = {
	destination: string;
	/** what the destination is on this broker, behind the field's info button */
	destinationInfo: string;
	placeholder: string;
	/** Kafka alone has a message key */
	key?: boolean;
	/** what the headers editor calls a row; none for Redis */
	headers?: string;
	options: OptionInfo[];
	/** the npm package whose types the Raw editor loads, and the client's type in it */
	types: { name: string; version: string; client: string };
	example: string;
};

/** Settings per integration variant; matches what the server's adapters accept. */
const BROKERS: Record<string, BrokerInfo> = {
	Kafka: {
		destination: "Topic",
		destinationInfo:
			"The name of the Kafka topic the message is written to. Type it, or use a js: expression that returns it.",
		placeholder: "orders",
		key: true,
		headers: "Header",
		options: [
			{ name: "partition", label: "Partition", hint: "Blank lets Kafka pick one from the key." },
			{
				name: "timestamp",
				label: "Timestamp",
				hint: "Milliseconds since 1970, or a date. Blank is now.",
			},
		],
		types: {
			name: "@platformatic/kafka",
			version: "2.11.0",
			client: 'import("@platformatic/kafka").Producer<string, string, string, string>',
		},
		example: `const result = await client.send({
  messages: [{ topic: "orders", key: "42", value: JSON.stringify({ id: 42 }) }],
});
return result.offsets;`,
	},
	NATS: {
		destination: "Subject",
		destinationInfo:
			"The subject to publish on. A JetStream stream must capture this subject, or the send fails.",
		placeholder: "orders.created",
		headers: "Header",
		options: [
			{
				name: "msgId",
				label: "Message ID",
				hint: "JetStream drops a second message with the same ID inside its duplicate window.",
			},
		],
		types: {
			name: "@nats-io/jetstream",
			version: "3.4.0",
			client: 'import("@nats-io/jetstream").JetStreamClient',
		},
		example: `const ack = await client.publish("orders.created", JSON.stringify({ id: 42 }));
return { stream: ack.stream, seq: ack.seq };`,
	},
	SQS: {
		destination: "Queue URL",
		destinationInfo:
			"The full URL of the SQS queue. Find it in the AWS console, on the queue's Details panel.",
		placeholder: "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
		headers: "Attribute",
		options: [
			{ name: "delaySeconds", label: "Delay (seconds)", hint: "0 to 900. Not for FIFO queues." },
			{ name: "groupId", label: "Message Group ID", hint: "Required by FIFO queues." },
			{
				name: "deduplicationId",
				label: "Deduplication ID",
				hint: "FIFO queues without content-based deduplication need one.",
			},
		],
		types: {
			name: "@aws-sdk/client-sqs",
			version: "3.1130.0",
			client: 'import("@aws-sdk/client-sqs").SQS',
		},
		example: `const sent = await client.sendMessage({
  QueueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/orders",
  MessageBody: JSON.stringify({ id: 42 }),
});
return sent.MessageId;`,
	},
	Redis: {
		destination: "Stream Key",
		destinationInfo:
			"The key of the Redis stream to append to. Redis creates the stream on the first message.",
		placeholder: "orders",
		options: [
			{
				name: "maxLen",
				label: "Max Length",
				hint: "Trims the stream to about this many entries. Blank keeps everything.",
			},
		],
		types: { name: "ioredis", version: "5.11.1", client: 'import("ioredis").Redis' },
		example: `const id = await client.xadd("orders", "*", "id", "42", "status", "new");
return id;`,
	},
};

const GENERIC: BrokerInfo = {
	destination: "Destination",
	destinationInfo:
		"Where the message goes. On Kafka it is a topic, on NATS a subject, on SQS a queue URL, on Redis a stream key. Pick an integration and this field is named for it.",
	placeholder: "orders",
	options: [],
	types: { name: "", version: "", client: "any" },
	example: "",
};

function useBroker(block: BlockNode) {
	const params = useParams({ strict: false }) as { projectId?: string };
	const connection = typeof block.data.connection === "string" ? block.data.connection : "";
	const { data } = integrationsQuery.getById.useQuery(params?.projectId ?? "", connection);
	return BROKERS[data?.variant ?? ""] ?? GENERIC;
}

/** Two or more exclusive choices written to one field, as a row of buttons. */
function Segmented({
	label,
	value,
	options,
	onChange,
}: {
	label: string;
	value: string;
	options: { value: string; label: string }[];
	onChange: (value: string) => void;
}) {
	const { enabled: editable } = useCanvasChanges();
	return (
		<div className="flex flex-col gap-1.5">
			<Label className="text-sm font-medium">{label}</Label>
			<div className="inline-flex p-1 bg-background-secondary border border-border rounded-lg gap-1 w-full">
				{options.map((option) => (
					<Button
						key={option.value}
						size="sm"
						variant={value === option.value ? "primary" : "ghost"}
						className="flex-1 text-xs font-medium"
						isDisabled={!editable}
						onPress={() => onChange(option.value)}
					>
						{option.label}
					</Button>
				))}
			</div>
		</div>
	);
}

type Payload = { source?: "raw" | "js"; value?: unknown };

function payloadOf(data: BlockData): Payload {
	const raw = data.payload;
	return typeof raw === "object" && raw !== null ? (raw as Payload) : { source: "raw", value: {} };
}

/** General tab: which integration, Simple or Raw, and where to send. */
export function SendMessageGeneralSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const broker = useBroker(block);
	const raw = block.data.mode === "raw";
	const list = block.data.bulk === true || block.data.useParam === true;

	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockIntegrationField
				blockId={block.id}
				data={block.data}
				name="connection"
				group="queue"
				extraGroups={[{ group: "kv", variants: ["Redis"] }]}
				// sending to RabbitMQ is #560; its integrations only feed triggers today
				excludeVariants={["RabbitMQ"]}
				label="Choose Message Queue"
				description="A Kafka, NATS JetStream or SQS integration, or a Redis integration to send to a stream."
			/>
			<Segmented
				label="Mode"
				value={raw ? "raw" : "simple"}
				options={[
					{ value: "simple", label: "Simple" },
					{ value: "raw", label: "Raw" },
				]}
				onChange={(mode) => updateNodeData(block.id, { mode })}
			/>
			{!raw && (
				<>
					<BlockJsTextField
						blockId={block.id}
						data={block.data}
						name="destination"
						label={broker.destination}
						placeholder={broker.placeholder}
						info={{
							content: list
								? `${broker.destinationInfo} In a list, a message can name its own with a destination field.`
								: broker.destinationInfo,
							example: broker.placeholder,
						}}
					/>
					<BlockCheckboxField
						blockId={block.id}
						data={block.data}
						name="useParam"
						label="Use Input as Payload"
						description="Send the previous block's output. A list sends one message per item."
					/>
				</>
			)}
		</div>
	);
}

/** Message tab: Single or Bulk, and the payload. Hidden when the input is the payload. */
export function SendMessageMessageSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const bulk = block.data.bulk === true;
	const payload = payloadOf(block.data);
	const source = payload.source ?? "raw";

	const setPayload = (next: Payload) => updateNodeData(block.id, { payload: next });
	const setSource = (next: string) => {
		if (next === source) return;
		setPayload(
			next === "js"
				? { source: "js", value: typeof payload.value === "string" ? payload.value : "" }
				: { source: "raw", value: bulk ? [] : {} },
		);
	};
	const setBulk = (next: boolean) => {
		// a JSON payload has to switch between an object and a list with it
		const fits = Array.isArray(payload.value) === next;
		updateNodeData(block.id, {
			bulk: next,
			...(source !== "js" && !fits ? { payload: { source: "raw", value: next ? [] : {} } } : {}),
		});
	};

	return (
		<div className="flex flex-col gap-4 w-full">
			<Segmented
				label="Messages"
				value={bulk ? "bulk" : "single"}
				options={[
					{ value: "single", label: "Single" },
					{ value: "bulk", label: "Bulk" },
				]}
				onChange={(value) => setBulk(value === "bulk")}
			/>
			<Segmented
				label="Payload"
				value={source}
				options={[
					{ value: "raw", label: "JSON" },
					{ value: "js", label: "JavaScript" },
				]}
				onChange={setSource}
			/>
			{source === "raw" ? (
				<JsonEditor
					rootType={bulk ? "array" : "object"}
					allowExpressions={true}
					isDisabled={!editable}
					isReadOnly={!editable}
					label={bulk ? "Messages" : "Message"}
					description={
						bulk
							? "One item per message. An item with a payload field can set its own destination, key and headers."
							: "Values support js: expressions."
					}
					value={
						(bulk
							? Array.isArray(payload.value)
								? payload.value
								: []
							: payload.value && typeof payload.value === "object" && !Array.isArray(payload.value)
								? payload.value
								: {}) as JsonArray | JsonObject
					}
					onChange={(value) => setPayload({ source: "raw", value })}
				/>
			) : (
				<div className="flex flex-col gap-1.5 w-full">
					<Label className="text-sm font-medium">JavaScript Code</Label>
					<Description className="text-xs text-muted">
						{bulk
							? "Return the list of messages to send."
							: "Return the message to send. A string is sent as-is; anything else as JSON."}
					</Description>
					<JavaScriptTextArea
						expandable
						expandTitle="Send Message - Payload"
						rows={10}
						showLineNumbers={true}
						readOnly={!editable}
						value={typeof payload.value === "string" ? payload.value : ""}
						onChange={(value) => setPayload({ source: "js", value })}
					/>
				</div>
			)}
		</div>
	);
}

/** One broker option, stored under `options` so every broker's live in one place. */
function OptionField({ block, option }: { block: BlockNode; option: OptionInfo }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const options = (block.data.options ?? {}) as Record<string, unknown>;
	const current = options[option.name];
	return (
		<JsTextField
			fullWidth
			variant="secondary"
			isDisabled={!editable}
			label={option.label}
			description={option.hint}
			placeholder={option.placeholder}
			value={current == null ? "" : String(current)}
			onChange={(next) => {
				const trimmed = next.trim();
				const number = Number(trimmed);
				const value =
					trimmed !== "" && !Number.isNaN(number) && !trimmed.startsWith("js:") ? number : next;
				updateNodeData(block.id, { options: { ...options, [option.name]: value } });
			}}
		/>
	);
}

/** Options tab: key, headers, the broker's own settings, and when a list counts as failed. */
export function SendMessageOptionsSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const broker = useBroker(block);
	// with the input as payload, a list may arrive at run time
	const list = block.data.bulk === true || block.data.useParam === true;
	const headers =
		typeof block.data.headers === "object" && block.data.headers !== null
			? (block.data.headers as Record<string, string>)
			: {};
	const empty = !broker.key && !broker.headers && broker.options.length === 0 && !list;

	return (
		<div className="flex flex-col gap-4 w-full">
			{broker.key && (
				<BlockJsTextField
					blockId={block.id}
					data={block.data}
					name="key"
					label="Key"
					placeholder="order-42"
					hint="Messages with the same key go to the same partition, in order. Supports js: expressions."
				/>
			)}
			{broker.headers && (
				<div className="flex flex-col gap-1.5 w-full">
					<Label className="text-sm font-medium">{`${broker.headers}s`}</Label>
					<HeadersEditor
						headers={headers}
						editable={editable}
						noun={broker.headers}
						onChange={(next) => updateNodeData(block.id, { headers: next })}
					/>
				</div>
			)}
			{broker.options.map((option) => (
				<OptionField key={option.name} block={block} option={option} />
			))}
			{list && (
				<BlockSelectField
					blockId={block.id}
					data={block.data}
					name="failWhen"
					label="Go to Error When"
					options={[
						{ value: "all", label: "All messages fail" },
						{ value: "any", label: "Any message fails" },
					]}
					hint="For a list of messages. Either way, the output lists which were sent and which failed."
				/>
			)}
			{empty && (
				<Description className="text-xs text-muted">
					Pick an integration to see its options.
				</Description>
			)}
		</div>
	);
}

/** Loads the client's types from jsDelivr into the editor. */
function ClientTypes({ name, version }: { name: string; version: string }) {
	usePackageTypes(name, version);
	return null;
}

/** Code tab: JavaScript with the broker's own client as `client`. */
export function SendMessageCodeSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const broker = useBroker(block);
	const code = typeof block.data.js === "string" ? block.data.js : "";

	return (
		<div className="flex flex-col gap-4 w-full">
			{broker.types.name && <ClientTypes name={broker.types.name} version={broker.types.version} />}
			<div className="flex items-start gap-2.5 p-3 rounded-lg bg-background-secondary border border-border text-xs text-muted leading-relaxed">
				<TbCode className="size-4 shrink-0 text-accent mt-0.5" />
				<div>
					<code className="font-mono text-foreground font-semibold px-1 py-0.5 rounded bg-surface-secondary">
						client
					</code>{" "}
					is the selected integration's own client, already connected. It is shared, so it cannot be
					closed. Whatever you return becomes this block's output; a throw takes the Error branch.
				</div>
			</div>
			<div className="flex flex-col gap-1.5 w-full">
				<Label className="text-sm font-medium">JavaScript Code</Label>
				<JavaScriptTextArea
					expandable
					expandTitle="Send Message - Raw Code"
					rows={14}
					showLineNumbers={true}
					readOnly={!editable}
					value={code}
					typeDefinitions={`declare const client: ${broker.types.client};`}
					onChange={(next) => updateNodeData(block.id, { js: next })}
				/>
			</div>
			{broker.example && (
				<div className="flex flex-col gap-1.5 w-full">
					<Label className="text-sm font-medium">Example</Label>
					<pre className="text-xs font-mono p-3 rounded-lg bg-background-secondary border border-border text-foreground overflow-x-auto">
						{broker.example}
					</pre>
				</div>
			)}
		</div>
	);
}

export function sendMessageSettings(block: BlockNode) {
	const general = (
		<BlockSettings.TabHead key="general" name="General">
			<SendMessageGeneralSettings block={block} />
		</BlockSettings.TabHead>
	);
	if (block.data.mode === "raw") {
		return [
			general,
			<BlockSettings.TabHead key="code" name="Code">
				<SendMessageCodeSettings block={block} />
			</BlockSettings.TabHead>,
		];
	}
	const options = (
		<BlockSettings.TabHead key="options" name="Options">
			<SendMessageOptionsSettings block={block} />
		</BlockSettings.TabHead>
	);
	// the input already is the message: nothing to fill in
	if (block.data.useParam === true) return [general, options];
	return [
		general,
		<BlockSettings.TabHead key="message" name="Message">
			<SendMessageMessageSettings block={block} />
		</BlockSettings.TabHead>,
		options,
	];
}
