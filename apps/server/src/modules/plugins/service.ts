import { type FluxifyManifest, fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import type { User } from "better-auth";
import { z } from "zod";
import { hasProjectAccess } from "../../api/auth/common";
import { republish as republishTrigger } from "../../api/v1/triggers/service";
import { db } from "../../db";
import { deleteArtifact, putArtifact } from "../../db/natsKv";
import type { AuthACL } from "../../db/schema";
import { BadRequestError } from "../../errors/badRequestError";
import { ConflictError } from "../../errors/conflictError";
import { ForbiddenError } from "../../errors/forbidError";
import { NotFoundError } from "../../errors/notFoundError";
import { ENVIRONMENTS } from "../../lib/envValues";
import { audit } from "../audit";
import type { PluginArtifact } from "../compiler/artifacts";
import { requestProjectCompile } from "../compiler/publisher";
import { pluginKey } from "../compiler/subjects";
import { blockMetaOf, integrationKindsOf, isUsableIn, liveOf, requestedPermissions } from "./meta";
import {
	getPluginRow,
	insertPluginRow,
	listPluginRows,
	type PluginInsert,
	type PluginRecord,
	updatePluginRow,
} from "./repository";
import { triggerKindsOf } from "./triggerKinds";
import { pluginTriggerRows } from "./triggerUsage";
import { assertUpgradeSafe } from "./upgrade";
import { pluginVariantState, syncPluginVariants, syncProjectPluginVariants } from "./variants";

/**
 * The plugin registry (#857). Sources (P2) hand a version over with
 * `registerPluginVersion`; a creator approves it; workers find what they may
 * load in the artifact bucket. Nothing here imports plugin code.
 */

export type Caller = { user: User & { isSystemAdmin: boolean }; acl: AuthACL[] };
export type PluginVersion = {
	/** `fluxify.json`, unparsed: it is validated here */
	manifest: unknown;
	/** the package's version (`package.json`); `fluxify.json` carries none */
	version: string;
	source: PluginRecord["source"];
	location: string;
	integrity: string;
	/**
	 * The plugin this version upgrades, when it is one (an upload from the
	 * plugin's own page): a manifest naming another plugin is refused.
	 */
	expectedName?: string;
};

function parseManifest(raw: unknown): FluxifyManifest {
	const parsed = fluxifyManifestSchema.safeParse(raw);
	if (!parsed.success)
		throw new BadRequestError(`Invalid fluxify.json: ${z.prettifyError(parsed.error)}`);
	return parsed.data;
}

async function rowFor(projectId: string, name: string) {
	const row = await getPluginRow(projectId, name);
	if (!row) throw new NotFoundError(`Plugin ${name} is not installed in this project`);
	return row;
}

/**
 * Records the version a source fetched. A new plugin waits for approval. The
 * same integrity changes nothing. Anything else is new code (the manifest is
 * inside what the integrity covers, so asking for more permissions is too), so
 * the plugin goes back to pending. A version that was approved keeps loading
 * until the new one is approved (`live`); nothing that loads changes here.
 */
export async function registerPluginVersion(projectId: string, version: PluginVersion) {
	const manifest = parseManifest(version.manifest);
	if (version.expectedName && manifest.name !== version.expectedName)
		throw new BadRequestError(
			`This is plugin ${manifest.name}, not ${version.expectedName}. A plugin's name never changes; install it as a new plugin instead.`,
		);
	if (!/^\d+\.\d+\.\d+$/.test(version.version))
		throw new BadRequestError(`Plugin version must be an exact version, got '${version.version}'`);
	const fields = {
		version: version.version,
		source: version.source,
		location: version.location,
		integrity: version.integrity,
		url: manifest.url,
		sdkRange: manifest.sdk,
		manifest,
	};
	const existing = await getPluginRow(projectId, manifest.name);
	if (!existing) {
		const row = await insertPluginRow({ projectId, name: manifest.name, ...fields });
		return { plugin: row, changed: true };
	}
	if (existing.integrity === version.integrity) return { plugin: existing, changed: false };
	// the approved version coming back while its upgrade waits: the upgrade is dropped
	if (existing.live?.integrity === version.integrity) {
		const row = await updatePluginRow(existing.id, {
			...fields,
			...existing.live,
			approval: "approved",
			live: null,
		});
		return { plugin: row, changed: true };
	}
	// #860: an approved version keeps loading, in both environments, until its upgrade is approved
	const live =
		existing.approval === "approved"
			? {
					version: existing.version,
					integrity: existing.integrity,
					source: existing.source,
					location: existing.location,
					manifest: existing.manifest,
					permissions: existing.permissions,
				}
			: existing.live;
	const row = await updatePluginRow(existing.id, {
		...fields,
		approval: "pending",
		approvedBy: null,
		approvedAt: null,
		status: "ok",
		lastError: null,
		live,
	});
	return { plugin: row, changed: true };
}

export function assertCreator(caller: Caller, projectId: string) {
	if (!hasProjectAccess(caller.user, caller.acl, projectId, "creator")) throw new ForbiddenError();
}

/**
 * A creator (or above) lets this exact version load, with the permissions its
 * manifest asks for now. `integrity` is what the creator looked at: a version
 * that changed since is refused instead of approved unseen.
 */
export async function approvePlugin(
	projectId: string,
	name: string,
	caller: Caller,
	integrity?: string,
) {
	assertCreator(caller, projectId);
	const row = await rowFor(projectId, name);
	if (integrity && integrity !== row.integrity)
		throw new ConflictError(`Plugin ${name} changed since it was reviewed; review it again`);
	await assertUpgradeSafe(row);
	await assertIntegrationKindsFree(row);
	const approved = await updateAudited(row, {
		approval: "approved",
		approvedBy: caller.user.id,
		approvedAt: new Date(),
		permissions: requestedPermissions(row.manifest),
		live: null,
	});
	await republish(approved, `plugin ${name} approved`);
	return approved;
}

/**
 * Nothing of a rejected plugin loads; `approvedBy`/`approvedAt` record who decided.
 * Rejecting a pending upgrade of an approved plugin only cancels the upgrade:
 * the approved version it would replace keeps loading, untouched.
 */
export async function rejectPlugin(projectId: string, name: string, caller: Caller) {
	assertCreator(caller, projectId);
	const row = await rowFor(projectId, name);
	if (row.approval === "pending" && row.live)
		return updateAudited(row, {
			...row.live,
			url: row.live.manifest.url,
			sdkRange: row.live.manifest.sdk,
			approval: "approved",
			approvedBy: null,
			approvedAt: null,
			status: "ok",
			lastError: null,
			live: null,
		});
	const rejected = await updateAudited(row, {
		approval: "rejected",
		approvedBy: caller.user.id,
		approvedAt: new Date(),
		permissions: null,
		live: null,
	});
	if (liveOf(row).approval === "approved") await republish(rejected, `plugin ${name} rejected`);
	return rejected;
}

export async function setPluginEnvironments(
	projectId: string,
	name: string,
	envs: { dev: boolean; prod: boolean },
	caller: Caller,
) {
	assertCreator(caller, projectId);
	const row = await rowFor(projectId, name);
	const updated = await updateAudited(row, { devEnabled: envs.dev, prodEnabled: envs.prod });
	if (liveOf(row).approval === "approved")
		await republish(updated, `plugin ${name} environments changed`);
	return updated;
}

/** a decision on the row, audited as the last step of its transaction */
const updateAudited = (row: PluginRecord, values: Partial<PluginInsert>) =>
	db.transaction(async (tx) => {
		const updated = await updatePluginRow(row.id, values, tx);
		await audit.record({
			projectId: row.projectId,
			resourceType: "plugin",
			resourceId: row.id,
			action: "update",
			changedFields: Object.keys(values),
		});
		return updated;
	});

/**
 * Two plugins of one project cannot provide the same integration kind: a row
 * names its kind, not its plugin, so it could not say which it means.
 */
async function assertIntegrationKindsFree(row: PluginRecord) {
	await syncProjectPluginVariants(row.projectId);
	for (const e of row.manifest.integrations ?? []) {
		const owner = pluginVariantState(row.projectId, e.group, e.variant)?.plugin;
		if (owner && owner !== row.name)
			throw new ConflictError(
				`Plugin ${row.name} provides integration variant ${e.group}/${e.variant}, which plugin ${owner} already provides in this project`,
			);
	}
}

export const listPlugins = listPluginRows;
/** with its integration variants (I6) and trigger kinds (T2) summarised for the approval page */
export const getPlugin = async (projectId: string, name: string) => {
	const row = await rowFor(projectId, name);
	return {
		...row,
		integrations: integrationKindsOf(row.manifest),
		triggers: triggerKindsOf(row.manifest),
	};
};

/**
 * What workers read: the plugin in each environment it may load in, nowhere
 * else. Approved means approved for this integrity, so the artifact carries it.
 */
export async function publishPlugin(stored: PluginRecord) {
	const row = liveOf(stored);
	const key = pluginKey(row.projectId, row.name);
	await Promise.all(
		ENVIRONMENTS.map((env) =>
			isUsableIn(row, env) ? putArtifact(key, pluginArtifact(row), env) : deleteArtifact(key, env),
		),
	);
}

export async function publishProjectPlugins(projectId: string) {
	for (const row of await listPluginRows(projectId)) await publishPlugin(row);
}

export function pluginArtifact(row: PluginRecord): PluginArtifact {
	return {
		projectId: row.projectId,
		name: row.name,
		version: row.version,
		integrity: row.integrity,
		source: row.source,
		location: row.location,
		approval: "approved",
		permissions: row.permissions ?? { integrations: [], appconfig: false },
		blocks: Object.fromEntries(
			Object.entries(row.manifest.blocks).map(([type, b]) => [
				type,
				{ entry: b.entry, meta: blockMetaOf(b) },
			]),
		),
		...(row.manifest.integrations?.length && { integrations: row.manifest.integrations }),
		...(row.manifest.triggers?.length && { triggers: row.manifest.triggers }),
		publishedAt: new Date().toISOString(),
	};
}

/**
 * Routing on plugin blocks is baked into emitted code, so whatever uses one
 * compiles again: its artifacts gain or lose the block, or fail naming why.
 * ponytail: rebuilds the whole project; narrow it to the plugin's users
 * (`blocks.type` under the plugin's prefix, plus promoted versions) if
 * projects get large.
 */
async function republish(row: PluginRecord, reason: string) {
	await publishPlugin(row);
	// this replica at once; the others through the artifact watch
	await syncPluginVariants(row.projectId, row.name);
	// its triggers follow it: published where it loads, withdrawn where it is off, rows kept
	for (const trigger of await pluginTriggerRows(row.projectId, row.name))
		await republishTrigger(trigger);
	await requestProjectCompile(row.projectId, reason);
}
