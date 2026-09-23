import { logger } from "@fluxify/common";
import { groupPair } from "@fluxify/common/orchestrator";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
	kafkaVariantConfigSchema,
	natsVariantConfigSchema,
	sqsVariantConfigSchema,
} from "../../api/v1/integrations/schemas";
import { kafkaSourceSchema, natsSourceSchema, sqsSourceSchema } from "../../api/v1/triggers/dto";
import { db } from "../../db";
import {
	integrationsEntity,
	nodeClaimsEntity,
	triggerGroupsEntity,
	triggersEntity,
} from "../../db/schema";
import { canRunConnectors, nodeEntitlement } from "../../lib/edition";
import { projectHost } from "../../lib/hosting";
import { orchestrationScalingSchema } from "../../lib/instance-settings/schemas";
import { baseDomain, getSetting } from "../../loaders/instanceSettingsLoader";
import { projectSubdomains } from "./claims";
import type { ExternalTrigger } from "./kubernetesSpec";
import { type Claim, type DesiredNode, projectDesiredNodes } from "./projection";
import { type ScalingContext, scalingCeilings } from "./scaling";

/**
 * What should be running, read from Postgres every pass.
 *
 * The orchestrator computes this itself rather than being told, which is what
 * settles cold start: booting against an empty KV it rebuilds the whole picture
 * from the database instead of asking admin for it (§2). It reads claims, the
 * pool ceiling and the license, and writes none of them — admin owns those rows
 * and this process owns the node rows, in both directions.
 */

export interface PoolLimits {
	maxNodes: number;
}

export interface DesiredState {
	nodes: DesiredNode[];
	pool: PoolLimits;
	scaling: ScalingContext;
	/** The rows themselves, for a driver that mirrors them (#448). */
	claims: Claim[];
}

export async function readDesiredState(): Promise<DesiredState> {
	const claims = await db
		.select({
			id: nodeClaimsEntity.id,
			projectId: nodeClaimsEntity.projectId,
			type: nodeClaimsEntity.type,
			groupIds: nodeClaimsEntity.groupIds,
			replicas: nodeClaimsEntity.replicas,
			maxReplicas: nodeClaimsEntity.maxReplicas,
			metadata: nodeClaimsEntity.metadata,
			createdAt: nodeClaimsEntity.createdAt,
		})
		.from(nodeClaimsEntity);

	const groups = await db
		.select({ id: triggerGroupsEntity.id, projectId: triggerGroupsEntity.projectId })
		.from(triggerGroupsEntity);

	// A claim's group list is jsonb, so deleting a group leaves its id behind
	// with nothing to cascade it away. Passing what exists drops those.
	const knownGroups = new Set(groups.map((group) => groupPair(group.projectId, group.id)));

	// Absent means the operator has not sized the pool, which is a ceiling of
	// zero: claims are recorded and sit `pending` rather than being forced onto
	// a host nobody has declared capacity for.
	const pool: PoolLimits = getSetting("orchestration_pool") ?? { maxNodes: 0 };

	const entitlement = nodeEntitlement();
	const nodes = projectDesiredNodes({
		claims: claims as Claim[],
		maxNodes: pool.maxNodes,
		entitlement,
		knownGroups,
	});
	// Recomputed every pass rather than stored, so a license change or a shrunk
	// pool reaches every claim's ceiling without anyone editing a claim.
	const scaling: ScalingContext = {
		policy: orchestrationScalingSchema.parse(getSetting("orchestration_scaling") ?? {}),
		ceilings: scalingCeilings(claims, pool.maxNodes, entitlement),
		triggersByGroup: await internalTriggersByGroup(),
		externalByGroup: await externalTriggersByGroup(),
	};
	// A pinned node serving APIs is reached on its project's own host, so the
	// host is part of what should be running: changing it replaces the node.
	const subdomains = await projectSubdomains();
	const domain = baseDomain();
	for (const node of nodes) {
		const subdomain = node.projectId && node.type !== "workflow" && subdomains.get(node.projectId);
		if (subdomain) node.host = projectHost(subdomain, domain);
	}
	return { nodes, pool, scaling, claims: claims as Claim[] };
}

async function internalTriggersByGroup(): Promise<Map<string, string[]>> {
	const rows = await db
		.select({ id: triggersEntity.id, groupId: triggersEntity.groupId })
		.from(triggersEntity)
		.where(
			and(
				eq(triggersEntity.type, "internal"),
				eq(triggersEntity.active, true),
				isNotNull(triggersEntity.workflowId),
			),
		);
	const byGroup = new Map<string, string[]>();
	for (const row of rows) byGroup.set(row.groupId, [...(byGroup.get(row.groupId) ?? []), row.id]);
	return byGroup;
}

/**
 * Active triggers on an outside queue with a workflow attached, with the
 * credentials KEDA needs to watch that queue, read and decrypted every pass.
 *
 * A trigger whose integration cannot be read gets no scaler, and the pass goes
 * on: one broken integration must not stop every claim from being reconciled.
 * An edition that no longer runs connectors gets none at all.
 */
async function externalTriggersByGroup(): Promise<Map<string, ExternalTrigger[]>> {
	const byGroup = new Map<string, ExternalTrigger[]>();
	if (!canRunConnectors()) return byGroup;
	const rows = await db
		.select({
			id: triggersEntity.id,
			groupId: triggersEntity.groupId,
			type: triggersEntity.type,
			projectId: triggersEntity.projectId,
			source: triggersEntity.source,
			config: integrationsEntity.config,
		})
		.from(triggersEntity)
		.innerJoin(integrationsEntity, eq(triggersEntity.integrationId, integrationsEntity.id))
		.where(
			and(
				inArray(triggersEntity.type, ["kafka", "sqs", "nats"]),
				eq(triggersEntity.active, true),
				isNotNull(triggersEntity.workflowId),
			),
		);
	if (rows.length === 0) return byGroup;

	// Loaded only when needed: it brings every integration adapter along.
	const { resolveQueueConfig } = await import("../../api/v1/integrations/test-connection/service");
	for (const row of rows) {
		try {
			const config = await resolveQueueConfig(
				row.projectId,
				(row.config ?? {}) as Record<string, unknown>,
			);
			const trigger = externalTrigger(row.id, row.type, row.source, config);
			if (trigger) byGroup.set(row.groupId, [...(byGroup.get(row.groupId) ?? []), trigger]);
		} catch {
			// Never the error itself: a parse failure can quote the credentials.
			logger.warn(
				`trigger ${row.id}: its integration cannot be read, so it does not scale its claim`,
				"ORCHESTRATOR",
			);
		}
	}
	return byGroup;
}

function externalTrigger(
	id: string,
	type: string,
	rawSource: unknown,
	config: Record<string, unknown>,
): ExternalTrigger | null {
	// The name the worker joins under when the user named none (`queueRuntime.ee.ts`).
	const generated = `fluxify-${id}`;
	if (type === "kafka") {
		const kafka = kafkaVariantConfigSchema.parse(config);
		const source = kafkaSourceSchema.parse(rawSource);
		return {
			id,
			type,
			brokers: kafka.brokers,
			consumerGroup: source.consumerGroup || generated,
			topics: source.topics,
			allowIdleConsumers: Boolean(source.allowIdleConsumers),
			tls: kafka.ssl,
			sasl: kafka.saslMechanism,
			username: kafka.username,
			password: kafka.password,
		};
	}
	if (type === "sqs") {
		const sqs = sqsVariantConfigSchema.parse(config);
		const source = sqsSourceSchema.parse(rawSource);
		const { accessKeyId, secretAccessKey, sessionToken } = sqs;
		return {
			id,
			type,
			queueUrl: source.queueUrl,
			region: sqs.region,
			endpoint: sqs.endpoint || undefined,
			// Blank keys: the connection test passed with the server's own AWS
			// identity when the trigger was saved, so KEDA uses its own.
			keys:
				accessKeyId && secretAccessKey
					? { accessKeyId, secretAccessKey, sessionToken: sessionToken || undefined }
					: undefined,
		};
	}
	if (type === "nats") {
		const nats = natsVariantConfigSchema.parse(config);
		// KEDA reads NATS over its HTTP monitoring port; without one, nothing to scale on.
		if (!nats.monitoringEndpoint) return null;
		const source = natsSourceSchema.parse(rawSource);
		return {
			id,
			type,
			monitoringEndpoint: nats.monitoringEndpoint,
			account: nats.account || "$G",
			stream: source.stream,
			consumer: source.consumerGroup || generated,
		};
	}
	return null;
}
