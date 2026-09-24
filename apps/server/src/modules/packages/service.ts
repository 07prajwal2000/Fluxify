import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { putArtifact } from "../../db/natsKv";
import { projectDependenciesEntity } from "../../db/schema";
import { ConflictError } from "../../errors/conflictError";
import { projectSettingsCache } from "../../loaders/projectSettingsLoader";
import type { DepsArtifact } from "../compiler/artifacts";
import { requestProjectCompile } from "../compiler/publisher";
import { depsKey } from "../compiler/subjects";
import { readLiveNodes } from "../orchestrator/status";
import {
	declaredPackages,
	lockedVersion,
	type ResolveChange,
	resolveDependencies,
} from "./resolver";

/**
 * A project's npm packages on the admin side (#477): read, change, check for
 * updates, and follow the rollout. Resolution happens once, here; every worker
 * installs the lockfile this publishes.
 */

const MIN_RELEASE_AGE_KEY = "settings.packages.minReleaseAgeDays";
const DEFAULT_MIN_RELEASE_AGE_DAYS = 7;
const REGISTRY = (process.env.NPM_REGISTRY_URL ?? "https://registry.npmjs.org").replace(/\/$/, "");

export function minReleaseAgeDays(projectId: string) {
	const configured = Number(projectSettingsCache[projectId]?.[MIN_RELEASE_AGE_KEY]);
	return Number.isInteger(configured) && configured >= 0
		? configured
		: DEFAULT_MIN_RELEASE_AGE_DAYS;
}

async function readRow(projectId: string) {
	const [row] = await db
		.select()
		.from(projectDependenciesEntity)
		.where(eq(projectDependenciesEntity.projectId, projectId));
	return row ?? null;
}

/** what the compiler needs to check and resolve a project's imports */
export async function compileDependencies(projectId: string) {
	const row = await readRow(projectId);
	return { projectId, packages: row ? Object.keys(declaredPackages(row.packageJson)) : [] };
}

export async function listPackages(projectId: string) {
	const row = await readRow(projectId);
	const declared = row ? declaredPackages(row.packageJson) : {};
	return {
		version: row?.version ?? 0,
		minReleaseAgeDays: minReleaseAgeDays(projectId),
		updatedAt: row?.updatedAt.toISOString() ?? null,
		packages: Object.entries(declared).map(([name, range]) => ({
			name,
			range,
			version: row ? lockedVersion(row.lockfile, name) : null,
		})),
	};
}

/**
 * Resolves the change against the stored manifest and saves it as the next
 * version — but only if nobody saved another version in between, so two
 * people installing at once cannot silently drop each other's package.
 */
export async function changePackages(projectId: string, change: ResolveChange, userId: string) {
	const row = await readRow(projectId);
	const resolved = await resolveDependencies(row, change, minReleaseAgeDays(projectId));
	const version = (row?.version ?? 0) + 1;
	const values = { ...resolved, version, updatedBy: userId };

	const saved = row
		? await db
				.update(projectDependenciesEntity)
				.set(values)
				.where(
					and(
						eq(projectDependenciesEntity.projectId, projectId),
						eq(projectDependenciesEntity.version, row.version),
					),
				)
				.returning({ updatedAt: projectDependenciesEntity.updatedAt })
		: await db
				.insert(projectDependenciesEntity)
				.values({ projectId, ...values })
				.onConflictDoNothing()
				.returning({ updatedAt: projectDependenciesEntity.updatedAt });
	if (!saved.length) {
		throw new ConflictError("The project's packages changed while this was resolving — try again");
	}

	const artifact: DepsArtifact = {
		projectId,
		version,
		...resolved,
		updatedAt: saved[0]!.updatedAt.toISOString(),
	};
	await putArtifact(depsKey(projectId), artifact);
	// a route that failed on a missing import compiles now
	await requestProjectCompile(projectId, "npm packages changed");
	return listPackages(projectId);
}

/** per node, how far the current version got; `done` once every node settled on it */
export async function installStatus(projectId: string) {
	const row = await readRow(projectId);
	const version = row?.version ?? 0;
	const nodes = (await readLiveNodes())
		.filter((node) => node.projectId === projectId || node.projectId === "*")
		.map((node) => ({
			nodeId: node.nodeId,
			type: node.type,
			status: node.deps?.[projectId] ?? null,
		}));
	const settled = (status: (typeof nodes)[number]["status"]) =>
		version === 0 ? !status : status?.version === version && status.state !== "installing";
	return { version, done: nodes.every((node) => settled(node.status)), nodes };
}

/**
 * The newest release of each package the age rule allows. Read from the
 * registry, not `bun outdated`, which needs an installed node_modules.
 */
export async function checkUpdates(projectId: string) {
	const { packages } = await listPackages(projectId);
	const cutoff = Date.now() - minReleaseAgeDays(projectId) * 86_400_000;
	return Promise.all(
		packages.map(async ({ name, version }) => {
			const latest = await newestAllowed(name, cutoff).catch(() => null);
			return {
				name,
				current: version,
				latest,
				hasUpdate: Boolean(latest && version && Bun.semver.order(latest, version) > 0),
			};
		}),
	);
}

async function newestAllowed(name: string, cutoff: number) {
	const response = await fetch(`${REGISTRY}/${name.replace("/", "%2f")}`, {
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) return null;
	const packument = (await response.json()) as { time?: Record<string, string> };
	const stable = Object.entries(packument.time ?? {})
		.filter(([version, at]) => /^\d+\.\d+\.\d+$/.test(version) && Date.parse(at) <= cutoff)
		.map(([version]) => version)
		.sort(Bun.semver.order);
	return stable.at(-1) ?? null;
}
