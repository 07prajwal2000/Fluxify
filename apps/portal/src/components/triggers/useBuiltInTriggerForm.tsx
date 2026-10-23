import { useState } from "react";
import type { WizardStep } from "@/components/common/FormWizard";
import {
	DELIVERY_DEFAULTS,
	DeliveryFields,
	hasGroup,
	KafkaSourceFields,
	NatsSourceFields,
	topicList,
} from "@/components/triggers/KafkaTriggerFields";
import { isRabbitQueue, RabbitMqSourceFields } from "@/components/triggers/RabbitMqTriggerFields";
import { isRedisName, RedisSourceFields } from "@/components/triggers/RedisTriggerFields";
import {
	isQueueUrl,
	queueName,
	SQS_MAX_BATCH,
	SqsSourceFields,
} from "@/components/triggers/SqsTriggerFields";
import type { ReviewRow } from "@/components/triggers/TriggerReview";
import { BATCH_DEFAULTS, BatchFields } from "@/components/triggers/triggerForm";
import { ScheduleFields } from "@/components/workflows/ScheduleFields";
import type { Trigger } from "@/services/triggers";

type SourceShape = {
	topics?: string[];
	consumerGroup?: string;
	fromBeginning?: boolean;
	createTopics?: boolean;
	allowIdleConsumers?: boolean;
	stream?: string;
	filterSubjects?: string[];
	queueUrl?: string;
	waitTimeSeconds?: number;
	visibilityTimeoutSec?: number;
	consumer?: string;
	claimIdleMs?: number;
	dlqStream?: string;
	queue?: string;
};

/**
 * The built-in sources' form state, their wizard steps and the body they
 * submit. A plugin kind has none of this — its own tabs are the steps — so it
 * all lives here rather than in the wizard.
 */
export function useBuiltInTriggerForm(initialTrigger?: Trigger) {
	const source = (initialTrigger?.source ?? {}) as SourceShape;
	const integrationId = initialTrigger?.integrationId ?? "";
	const [kafka, setKafka] = useState({
		integrationId,
		topics: (source.topics ?? []).join(", "),
		consumerGroup: source.consumerGroup ?? null,
		fromBeginning: Boolean(source.fromBeginning),
		createTopics: Boolean(source.createTopics),
		allowIdleConsumers: Boolean(source.allowIdleConsumers),
	});
	const [nats, setNats] = useState({
		integrationId,
		stream: source.stream ?? "",
		subjects: (source.filterSubjects ?? []).join(", "),
		consumerGroup: source.consumerGroup ?? null,
		fromBeginning: Boolean(source.fromBeginning),
	});
	const [sqs, setSqs] = useState({
		integrationId,
		queueUrl: source.queueUrl ?? "",
		waitTimeSeconds: source.waitTimeSeconds ?? 20,
		visibilityTimeoutSec: source.visibilityTimeoutSec ?? 30,
	});
	const [redis, setRedis] = useState({
		integrationId,
		stream: source.stream ?? "",
		consumerGroup: source.consumerGroup ?? null,
		consumer: source.consumer ?? "",
		fromBeginning: Boolean(source.fromBeginning),
		claimIdleSec: Math.round((source.claimIdleMs ?? 60_000) / 1000),
		dlqStream: source.dlqStream ?? "",
	});
	const [rabbit, setRabbit] = useState({ integrationId, queue: source.queue ?? "" });
	const [batch, setBatch] = useState({
		batchSize: initialTrigger?.batchSize ?? BATCH_DEFAULTS.batchSize,
		maxWaitMs: initialTrigger?.maxWaitMs ?? BATCH_DEFAULTS.maxWaitMs,
		maxBytes: initialTrigger?.maxBytes ?? BATCH_DEFAULTS.maxBytes,
		concurrency: initialTrigger?.concurrency ?? BATCH_DEFAULTS.concurrency,
	});
	const [delivery, setDelivery] = useState({
		commitMode: (initialTrigger?.commitMode as "auto" | "manual") ?? DELIVERY_DEFAULTS.commitMode,
		maxAttempts: initialTrigger?.maxAttempts ?? DELIVERY_DEFAULTS.maxAttempts,
		retryDelayMs: initialTrigger?.retryDelayMs ?? DELIVERY_DEFAULTS.retryDelayMs,
	});
	const [schedule, setSchedule] = useState({
		schedule: initialTrigger?.schedule ?? "",
		timezone: initialTrigger?.timezone || "UTC",
	});

	const topics = topicList(kafka.topics);
	const subjects = topicList(nats.subjects);

	/** The source and delivery steps of a connector, or the schedule step. */
	function stepsFor(type: string, projectId: string, isEdit: boolean): WizardStep[] {
		if (type === "schedule")
			return [
				{
					key: "schedule",
					label: "Schedule",
					title: "Say when it runs",
					description:
						"The preview below is the schedule that will actually run — check it before moving on.",
					isValid: schedule.schedule.trim().length > 0,
					content: <ScheduleFields value={schedule} onChange={setSchedule} />,
				},
			];
		const connectorSteps: Record<string, Omit<WizardStep, "key" | "title">> = {
			nats: {
				label: "Stream",
				description: "The NATS integration to connect with, and the stream to read.",
				isValid:
					Boolean(nats.integrationId) &&
					nats.stream.trim().length > 0 &&
					hasGroup(nats.consumerGroup),
				content: (
					<NatsSourceFields projectId={projectId} value={nats} onChange={setNats} isEdit={isEdit} />
				),
			},
			kafka: {
				label: "Topics",
				description: "The Kafka integration to connect with, and the topics to read.",
				isValid: Boolean(kafka.integrationId) && topics.length > 0 && hasGroup(kafka.consumerGroup),
				content: (
					<KafkaSourceFields
						projectId={projectId}
						value={kafka}
						onChange={setKafka}
						isEdit={isEdit}
					/>
				),
			},
			sqs: {
				label: "Queue",
				description: "The SQS integration to connect with, and the queue to read.",
				isValid: Boolean(sqs.integrationId) && isQueueUrl(sqs.queueUrl),
				content: <SqsSourceFields projectId={projectId} value={sqs} onChange={setSqs} />,
			},
			redis: {
				label: "Stream",
				description: "The Redis integration to connect with, and the stream to read.",
				isValid:
					Boolean(redis.integrationId) &&
					isRedisName(redis.stream.trim()) &&
					hasGroup(redis.consumerGroup) &&
					[redis.consumer, redis.dlqStream].every(
						(name) => !name.trim() || isRedisName(name.trim()),
					),
				content: (
					<RedisSourceFields
						projectId={projectId}
						value={redis}
						onChange={setRedis}
						isEdit={isEdit}
					/>
				),
			},
			rabbitmq: {
				label: "Queue",
				description: "The RabbitMQ integration to connect with, and the queue to read.",
				isValid: Boolean(rabbit.integrationId) && isRabbitQueue(rabbit.queue.trim()),
				content: <RabbitMqSourceFields projectId={projectId} value={rabbit} onChange={setRabbit} />,
			},
		};
		const sourceStep = connectorSteps[type];
		if (!sourceStep) return [];
		return [
			{ key: "source", title: "Say what it reads", ...sourceStep },
			{
				key: "delivery",
				label: "Delivery",
				title: "Shape each run",
				description: "How many messages one run gets, and what happens when a run fails.",
				content: (
					<div className="flex flex-col gap-6">
						<BatchFields
							value={batch}
							maxBatch={type === "sqs" ? SQS_MAX_BATCH : undefined}
							onChange={(key, next) => setBatch((previous) => ({ ...previous, [key]: next }))}
						/>
						<DeliveryFields
							value={delivery}
							onChange={setDelivery}
							nativeRetries={type === "sqs"}
						/>
					</div>
				),
			},
		];
	}

	/** What the row's body adds for this type. */
	function fieldsFor(type: string): Record<string, unknown> {
		if (type === "schedule")
			return { schedule: schedule.schedule.trim(), timezone: schedule.timezone || "UTC" };
		const connectorFields: Record<string, Record<string, unknown>> = {
			kafka: {
				integrationId: kafka.integrationId,
				source: {
					topics,
					// No group of their own means the generated one; the key is left off entirely.
					...(kafka.consumerGroup ? { consumerGroup: kafka.consumerGroup.trim() } : {}),
					fromBeginning: kafka.fromBeginning,
					createTopics: kafka.createTopics,
					allowIdleConsumers: kafka.allowIdleConsumers,
				},
			},
			nats: {
				integrationId: nats.integrationId,
				source: {
					stream: nats.stream.trim(),
					...(subjects.length ? { filterSubjects: subjects } : {}),
					...(nats.consumerGroup ? { consumerGroup: nats.consumerGroup.trim() } : {}),
					fromBeginning: nats.fromBeginning,
				},
			},
			sqs: {
				integrationId: sqs.integrationId,
				source: {
					queueUrl: sqs.queueUrl.trim(),
					waitTimeSeconds: sqs.waitTimeSeconds,
					visibilityTimeoutSec: sqs.visibilityTimeoutSec,
				},
			},
			redis: {
				integrationId: redis.integrationId,
				source: {
					stream: redis.stream.trim(),
					...(redis.consumerGroup ? { consumerGroup: redis.consumerGroup.trim() } : {}),
					...(redis.consumer.trim() ? { consumer: redis.consumer.trim() } : {}),
					fromBeginning: redis.fromBeginning,
					claimIdleMs: redis.claimIdleSec * 1000,
					...(redis.dlqStream.trim() ? { dlqStream: redis.dlqStream.trim() } : {}),
				},
			},
			rabbitmq: { integrationId: rabbit.integrationId, source: { queue: rabbit.queue.trim() } },
		};
		const maxBatch = type === "sqs" ? SQS_MAX_BATCH : undefined;
		const batchSize = Math.min(batch.batchSize, maxBatch ?? batch.batchSize);
		return { ...connectorFields[type], ...batch, batchSize, ...delivery };
	}

	/** The Review rows of the built-in type. */
	function reviewRows(type: string): ReviewRow[] {
		if (type === "schedule")
			return [
				{ label: "Schedule", value: schedule.schedule, mono: true },
				{ label: "Timezone", value: schedule.timezone },
			];
		const readsFrom: Record<string, ReviewRow> = {
			kafka: { label: "Topics", value: topics.join(", "), mono: true },
			nats: { label: "Stream", value: nats.stream.trim(), mono: true },
			sqs: { label: "Queue", value: queueName(sqs.queueUrl), mono: true },
			redis: { label: "Stream", value: redis.stream.trim(), mono: true },
			rabbitmq: { label: "Queue", value: rabbit.queue.trim(), mono: true },
		};
		const maxBatch = type === "sqs" ? SQS_MAX_BATCH : undefined;
		const batchSize = Math.min(batch.batchSize, maxBatch ?? batch.batchSize);
		return [
			...(readsFrom[type] ? [readsFrom[type]] : []),
			{ label: "Batch size", value: String(batchSize) },
			{
				label: "Commit",
				value: delivery.commitMode === "manual" ? "From the workflow" : "After each run",
			},
		];
	}

	return {
		delivery,
		setDelivery,
		stepsFor,
		fieldsFor,
		reviewRows,
	};
}
