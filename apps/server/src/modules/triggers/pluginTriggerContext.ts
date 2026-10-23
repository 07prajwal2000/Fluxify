import { type TriggerEvent, withCtxIntegrations } from "@fluxify/blocks";
import { logger, MissingEnvValueError } from "@fluxify/common";
import { backoffMs } from "@fluxify/common/nats";
import {
	checkEmit,
	type EmitOptions,
	grantContext,
	type TriggerContext,
	triggerGetConfig,
	triggerSecretKeys,
} from "@fluxify/sdk/runtime";
import type { AnyTrigger } from "@fluxify/sdk/triggers";
import { missingAppConfigMessage } from "../../lib/envValues";
import { getAppConfig, getProjectAppConfig } from "../../loaders/appconfigLoader";
import { findIntegrationConfig } from "../../loaders/integrationsLoader";
import type { TriggerArtifact } from "../compiler/artifacts";
import { WORKFLOW_JOB } from "../jobs/subjects";
import type { JobEnvelope } from "../jobs/types";
import { runWorkflowJob } from "../jobs/workflowJob";
import { compiledWorkflow } from "../requestRouter/compiledRuntime";
import { integrationFor } from "../requestRouter/pluginPermissions";
import type { PluginTriggerRef } from "../requestRouter/pluginTriggers";
import { createJobContext } from "../requestRouter/service";
import { maxAttemptsOf, retryDelayOf } from "./queueRuntime";
import { triggerScope } from "./strayErrors";
import type { TriggerBatch } from "./types";

/** what the runtime reads of a plugin's `trigger(...)` */
export type TriggerModule = Pick<AnyTrigger, "name" | "params" | "start">;

const TAG = "TRIGGERS.plugin";

/**
 * What `start` reads that this environment may lack: the app config value each
 * secret param names, and each integration param's config (and with
 * `permissions.appconfig`, all of the project's app config). Throws
 * `MissingEnvValueError` when one has no value here; otherwise returns their
 * fingerprint, so a config change restarts only the triggers it touches.
 */
export function resolvedInputs(
	artifact: TriggerArtifact,
	ref: PluginTriggerRef,
	def: TriggerModule,
) {
	const source = artifact.source ?? {};
	const secrets = triggerSecretKeys(def, source).map((key) => {
		const value = getAppConfig(artifact.projectId, key);
		if (value === undefined) throw new MissingEnvValueError(missingAppConfigMessage(key));
		return value;
	});
	const integrations = Object.entries((def.params ?? {}) as Record<string, { type: string }>)
		.filter(([name, p]) => p.type === "integration" && typeof source[name] === "string")
		.map(([name]) => findIntegrationConfig(source[name] as string) ?? null);
	const appConfig = ref.permissions.appconfig ? getProjectAppConfig(artifact.projectId) : null;
	return String(Bun.hash(JSON.stringify([secrets, integrations, appConfig])));
}

/** app config as `ctx.getConfig` reads it: a key with no value here throws its reason */
const appConfigOf = (projectId: string) =>
	new Proxy({} as Record<string, string | number | boolean | undefined>, {
		get: (_, key) => (typeof key === "string" ? getAppConfig(projectId, key) : undefined),
	});

const logLine = (value: unknown) => {
	if (typeof value === "string") return value;
	if (value instanceof Error) return value.message;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

/** what the runtime hands one instance's `ctx`, and owns of it */
export type InstanceHooks = {
	signal: AbortSignal;
	fail(error: unknown): void;
	stopped(): boolean;
};

/**
 * One instance's `ctx`, and `release()` for when it stops.
 *
 * A trigger is long-lived, not a request: its integrations come from the same
 * pools a plugin block's do (databases from the worker's connection manager,
 * other groups by their `poolKey`), but its leases are held until it stops
 * rather than per run. Each id is opened once per instance, so a poll loop
 * calling `ctx.integrations.get` every round holds one lease, not one per round.
 */
export function openContext(
	artifact: TriggerArtifact,
	ref: PluginTriggerRef,
	def: TriggerModule,
	hooks: InstanceHooks,
) {
	const label = `trigger ${def.name}`;
	const params = artifact.source ?? {};
	const getConfig = triggerGetConfig(
		def.name,
		{ params: def.params, permissions: ref.permissions },
		params,
		appConfigOf(artifact.projectId),
	);
	const base = createJobContext({
		id: artifact.triggerId,
		projectId: artifact.projectId,
		target: artifact.workflowId,
	});
	const open = withCtxIntegrations(base, (id) => integrationFor(artifact.projectId, id));
	const granted = grantContext(
		{ vars: { getConfig } as never, integrations: open.ctx.integrations },
		ref.permissions,
		label,
	).integrations!;
	const clients = new Map<string, Promise<unknown>>();
	const get = (id: string | undefined) => {
		const key = String(id);
		let client = clients.get(key);
		if (!client) {
			client = granted.get(id);
			clients.set(key, client);
			// a failed open is not kept: the next call tries again
			client.catch(() => clients.delete(key));
		}
		return client;
	};
	const tag = `[trigger ${artifact.triggerId} ${def.name}]`;
	const ctx: TriggerContext = {
		params: params as never,
		integrations: { get } as TriggerContext["integrations"],
		getConfig,
		logger: {
			logInfo: (value) => logger.info(`${tag} ${logLine(value)}`, TAG),
			logWarn: (value) => logger.warn(`${tag} ${logLine(value)}`, TAG),
			logError: (value) => logger.error(`${tag} ${logLine(value)}`, TAG),
		},
		signal: hooks.signal,
		emit: (events, options) => emit(artifact, def.name, hooks.stopped, events, options),
		fail: hooks.fail,
	};
	return {
		ctx,
		release() {
			open.release();
			base.dbFactory?.dispose();
		},
	};
}

/**
 * Runs the workflow over `events`, in this process. One run, or with `retry`
 * the trigger's Attempts setting with `runBatch`'s backoff; it rejects with the
 * last run's error. Nothing is committed or dead-lettered here: delivery is
 * the trigger author's. Concurrent calls run concurrently.
 */
async function emit(
	artifact: TriggerArtifact,
	name: string,
	stopped: () => boolean,
	events: unknown[],
	options?: EmitOptions,
) {
	checkEmit(name, events, options);
	const maxAttempts = artifact.plugin?.retry ? maxAttemptsOf(artifact) : 1;
	const receivedAt = new Date().toISOString();
	let failure: unknown;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		// like `runBatch`: neither is a failed run, so neither spends an attempt
		if (stopped()) throw new Error(`trigger ${artifact.triggerId} is no longer running`);
		if (!compiledWorkflow(artifact.workflowId))
			throw new Error(`workflow ${artifact.workflowId} is not loaded on this worker`);
		try {
			// outside the trigger's scope: what the workflow leaves floating is not the trigger's crash
			return await triggerScope.exit(() =>
				runWorkflowJob(jobFor(artifact, events, receivedAt, attempt), {
					connection: options?.connection,
					meta: { attempt },
				}),
			);
		} catch (error) {
			failure = error;
			logger.warn(
				`[triggers] ${artifact.triggerId} run failed (attempt ${attempt}/${maxAttempts}): ${String(error)}`,
				TAG,
			);
			if (attempt < maxAttempts) await Bun.sleep(backoffMs(retryDelayOf(artifact), attempt));
		}
	}
	throw failure;
}

function jobFor(
	artifact: TriggerArtifact,
	events: unknown[],
	receivedAt: string,
	attempt: number,
): JobEnvelope {
	const source = artifact.type as TriggerBatch["source"];
	return {
		id: crypto.randomUUID(),
		kind: WORKFLOW_JOB,
		projectId: artifact.projectId,
		target: artifact.workflowId,
		payload: {
			triggerId: artifact.triggerId,
			source,
			events: events.map((data): TriggerEvent => ({ data, meta: { receivedAt, source, attempt } })),
		} satisfies TriggerBatch,
		origin: { triggerId: artifact.triggerId, source },
		enqueuedAt: receivedAt,
		attempt,
	};
}
