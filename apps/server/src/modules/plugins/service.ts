import { type FluxifyManifest, fluxifyManifestSchema } from "@fluxify/sdk/blocks";
import type { User } from "better-auth";
import { z } from "zod";
import { hasProjectAccess } from "../../api/auth/common";
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
import { blockMetaOf, isUsableIn, requestedPermissions } from "./meta";
import {
	getPluginRow,
	insertPluginRow,
	listPluginRows,
	type PluginInsert,
	type PluginRecord,
	updatePluginRow,
} from "./repository";

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
 * the plugin goes back to pending and stops loading until it is approved again.
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
	const wasApproved = existing.approval === "approved";
	const row = await updatePluginRow(existing.id, {
		...fields,
		approval: "pending",
		approvedBy: null,
		approvedAt: null,
		status: "ok",
		lastError: null,
	});
	if (wasApproved) await republish(row, `plugin ${row.name} changed and needs approval again`);
	return { plugin: row, changed: true };
}

function assertCreator(caller: Caller, projectId: string) {
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
	const approved = await updateAudited(row, {
		approval: "approved",
		approvedBy: caller.user.id,
		approvedAt: new Date(),
		permissions: requestedPermissions(row.manifest),
	});
	await republish(approved, `plugin ${name} approved`);
	return approved;
}

/** Nothing of a rejected plugin loads; `approvedBy`/`approvedAt` record who decided. */
export async function rejectPlugin(projectId: string, name: string, caller: Caller) {
	assertCreator(caller, projectId);
	const row = await rowFor(projectId, name);
	const rejected = await updateAudited(row, {
		approval: "rejected",
		approvedBy: caller.user.id,
		approvedAt: new Date(),
		permissions: null,
	});
	if (row.approval === "approved") await republish(rejected, `plugin ${name} rejected`);
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
	if (row.approval === "approved") await republish(updated, `plugin ${name} environments changed`);
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

export const listPlugins = listPluginRows;
export const getPlugin = rowFor;

/**
 * What workers read: the plugin in each environment it may load in, nowhere
 * else. Approved means approved for this integrity, so the artifact carries it.
 */
export async function publishPlugin(row: PluginRecord) {
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
	await requestProjectCompile(row.projectId, reason);
}
