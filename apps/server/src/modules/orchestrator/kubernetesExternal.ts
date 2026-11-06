import type { ScalingPolicy } from "../../lib/instance-settings/schemas";
import { lagPath } from "../triggers/lagShared";
import { isWellFormedId, MANAGED_BY, MANAGED_LABEL } from "./containerSpec";
import type { KubeObject } from "./drivers/kubernetesApi";

/**
 * The triggers KEDA watches itself, one scaler and one Secret each: a queue the
 * trigger reads from, or a plugin trigger's own lag. Credentials here go only
 * into the trigger's Secret, never into a block or a ScaledObject.
 */

/**
 * A trigger that reads an outside queue, as much as KEDA needs to watch it.
 * Credentials here go only into the trigger's Secret, never into a block.
 */
export type ExternalTrigger = { id: string } & (
	| {
			type: "kafka";
			brokers: string;
			consumerGroup: string;
			topics: string[];
			allowIdleConsumers: boolean;
			tls: boolean;
			sasl: "none" | "PLAIN" | "SCRAM-SHA-256" | "SCRAM-SHA-512";
			username?: string;
			password?: string;
	  }
	| {
			type: "sqs";
			queueUrl: string;
			region: string;
			endpoint?: string;
			/** Absent: KEDA reads the queue with its own AWS identity. */
			keys?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string };
	  }
	| {
			type: "nats";
			/** The outside server's HTTP monitoring, `host:port` or a URL, as reachable from KEDA. */
			monitoringEndpoint: string;
			account: string;
			stream: string;
			consumer: string;
	  }
	| {
			type: "redis";
			/** `host:port` */
			address: string;
			username?: string;
			password?: string;
			databaseIndex?: string;
			tls: boolean;
			stream: string;
			consumerGroup: string;
	  }
	| {
			type: "rabbitmq";
			/** `amqp(s)://user:pass@host:port/vhost`, credentials included: Secret only */
			url: string;
			queue: string;
	  }
	| {
			/**
			 * A plugin trigger's own backlog (#963): KEDA reads it from the workers'
			 * health port, with `token` as its bearer. Every worker of the claim runs
			 * the trigger, so any of them answers.
			 */
			type: "plugin-lag";
			/** The trigger's `lagPerWorker`: how much backlog one worker clears. */
			lagPerWorker: number;
			token: string;
	  }
);

export const triggerSecretName = (triggerId: string) => `fluxify-trigger-${triggerId}`;
/** Marks the objects that belong to one trigger rather than to a claim. */
export const TRIGGER_LABEL = "fluxify.trigger-id";

/** Where KEDA's HTTP call to a NATS monitoring endpoint goes: `host:port`, and whether over https. */
function monitoring(endpoint: string) {
	const https = endpoint.startsWith("https://");
	return { host: endpoint.replace(/^https?:\/\//, "").replace(/\/$/, ""), https };
}

/** The ScaledObject block for one outside queue. Nothing secret: that is in its authentication. */
export function externalScaler(
	trigger: ExternalTrigger,
	policy: ScalingPolicy,
	/** Where the claim's workers answer on their health port, `http://<service>.<namespace>.svc:<port>`. */
	workers = "",
) {
	const threshold = String(policy.queuedPerNode);
	const authenticationRef = { name: triggerSecretName(trigger.id) };
	switch (trigger.type) {
		case "kafka":
			return {
				type: "kafka",
				metadata: {
					bootstrapServers: trigger.brokers,
					consumerGroup: trigger.consumerGroup,
					// One topic is named; with several, KEDA sums every topic the group reads.
					...(trigger.topics.length === 1 ? { topic: trigger.topics[0]! } : {}),
					lagThreshold: threshold,
					allowIdleConsumers: String(trigger.allowIdleConsumers),
				},
				authenticationRef,
			};
		case "sqs":
			return {
				type: "aws-sqs-queue",
				metadata: {
					queueURL: trigger.queueUrl,
					queueLength: threshold,
					awsRegion: trigger.region,
					...(trigger.endpoint ? { awsEndpoint: trigger.endpoint } : {}),
				},
				authenticationRef,
			};
		case "nats": {
			const { host, https } = monitoring(trigger.monitoringEndpoint);
			return {
				type: "nats-jetstream",
				metadata: {
					natsServerMonitoringEndpoint: host,
					account: trigger.account,
					stream: trigger.stream,
					consumer: trigger.consumer,
					lagThreshold: threshold,
					...(https ? { useHttps: "true" } : {}),
				},
			};
		}
		case "redis":
			return {
				// lag mode, the only one that scales to zero; it needs Redis 7
				type: "redis-streams",
				metadata: {
					address: trigger.address,
					stream: trigger.stream,
					consumerGroup: trigger.consumerGroup,
					lagCount: threshold,
					activationLagCount: "0",
					...(trigger.databaseIndex ? { databaseIndex: trigger.databaseIndex } : {}),
					...(trigger.tls ? { enableTLS: "true" } : {}),
				},
				...(trigger.username || trigger.password ? { authenticationRef } : {}),
			};
		case "rabbitmq":
			return {
				// ready messages only, read over AMQP; the URL comes from the Secret as `host`
				type: "rabbitmq",
				metadata: {
					protocol: "amqp",
					queueName: trigger.queue,
					mode: "QueueLength",
					value: threshold,
					activationValue: "0",
				},
				authenticationRef,
			};
		case "plugin-lag":
			return {
				type: "metrics-api",
				// AverageValue: replicas = ceil(lag / lagPerWorker), as the queue scalers do
				metricType: "AverageValue",
				metadata: {
					url: `${workers}${lagPath(trigger.id)}`,
					valueLocation: "lag",
					targetValue: String(trigger.lagPerWorker),
					authMode: "bearer",
				},
				authenticationRef,
			};
	}
}

/** What an outside queue's credentials become: the Secret's keys, named as KEDA reads them. */
export function externalSecretData(trigger: ExternalTrigger): Record<string, string> | null {
	if (trigger.type === "kafka") {
		const sasl = {
			none: "none",
			PLAIN: "plaintext",
			"SCRAM-SHA-256": "scram_sha256",
			"SCRAM-SHA-512": "scram_sha512",
		}[trigger.sasl];
		return {
			sasl,
			tls: trigger.tls ? "enable" : "disable",
			...(trigger.username ? { username: trigger.username } : {}),
			...(trigger.password ? { password: trigger.password } : {}),
		};
	}
	if (trigger.type === "sqs" && trigger.keys) {
		return {
			awsAccessKeyID: trigger.keys.accessKeyId,
			awsSecretAccessKey: trigger.keys.secretAccessKey,
			...(trigger.keys.sessionToken ? { awsSessionToken: trigger.keys.sessionToken } : {}),
		};
	}
	if (trigger.type === "redis" && (trigger.username || trigger.password)) {
		return {
			...(trigger.username ? { username: trigger.username } : {}),
			...(trigger.password ? { password: trigger.password } : {}),
		};
	}
	if (trigger.type === "rabbitmq") return { host: trigger.url };
	// KEDA presents it as the Authorization header; the workers derive the same one
	if (trigger.type === "plugin-lag") return { token: trigger.token };
	// NATS's scaler reads only the monitoring endpoint; SQS without keys uses KEDA's identity;
	// a Redis without a password needs nothing.
	return null;
}

/**
 * How KEDA authenticates one trigger's scaler: every key of its Secret, or,
 * for SQS without keys, KEDA's own AWS identity. Named like the Secret, so a
 * block finds it without a lookup. NATS needs none.
 */
export function buildTriggerAuthentication(
	trigger: ExternalTrigger,
	data: Record<string, string> | null,
): KubeObject | null {
	if (!isWellFormedId(trigger.id))
		throw new Error(`refusing a malformed trigger id: ${trigger.id}`);
	if (trigger.type === "nats" || (trigger.type === "redis" && !data)) return null;
	const spec = data
		? {
				secretTargetRef: Object.keys(data).map((key) => ({
					parameter: key,
					name: triggerSecretName(trigger.id),
					key,
				})),
			}
		: { podIdentity: { provider: "aws", identityOwner: "keda" } };
	return {
		apiVersion: "keda.sh/v1alpha1",
		kind: "TriggerAuthentication",
		metadata: {
			name: triggerSecretName(trigger.id),
			labels: { [MANAGED_LABEL]: MANAGED_BY, [TRIGGER_LABEL]: trigger.id },
		},
		spec,
	};
}
