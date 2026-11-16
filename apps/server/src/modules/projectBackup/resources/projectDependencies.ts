import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../../db";
import { putArtifactEverywhere } from "../../../db/natsKv";
import { projectDependenciesEntity } from "../../../db/schema";
import type { DepsArtifact } from "../../compiler/artifacts";
import { depsKey } from "../../compiler/subjects";
import type { BackupModule } from "../types";

/**
 * A project's npm packages (#1100): the manifest and the lockfile, as stored,
 * so workers install exactly the versions the source project ran. Nothing is
 * resolved again. As a package change does, the restore publishes the lockfile
 * for workers to install, after the commit; the project compile the caller
 * requests then builds the routes that import them.
 */

const schema = z.object({
	/** null when the project never installed a package */
	dependencies: z
		.object({
			version: z.number().int().min(1),
			packageJson: z.string(),
			lockfile: z.string(),
		})
		.nullable(),
});
type Section = z.infer<typeof schema>;

export const projectDependenciesModule: BackupModule<Section> = {
	name: "projectDependencies",
	version: 1,
	minSupported: 1,
	upgrades: {},
	dependsOn: [],
	schema,

	/** one item per package in package.json */
	preview({ dependencies }) {
		let pkg: { dependencies?: Record<string, string> } = {};
		try {
			pkg = JSON.parse(dependencies?.packageJson ?? "{}");
		} catch {}
		return Object.entries(pkg.dependencies ?? {}).map(([name, version]) => ({
			name,
			summary: version,
			details: { Version: version },
		}));
	},

	async export({ projectId }) {
		const [row] = await db
			.select()
			.from(projectDependenciesEntity)
			.where(eq(projectDependenciesEntity.projectId, projectId));
		const dependencies = row
			? { version: row.version, packageJson: row.packageJson, lockfile: row.lockfile }
			: null;
		return { data: { dependencies } };
	},

	/**
	 * A rollback replaces the packages with the backup's and moves the version on,
	 * which is what makes workers install again. A backup with none leaves
	 * today's packages alone, in either mode.
	 */
	async import({ tx, projectId, afterCommit }, { dependencies }) {
		if (!dependencies) return;
		const [current] = await tx
			.select({ version: projectDependenciesEntity.version })
			.from(projectDependenciesEntity)
			.where(eq(projectDependenciesEntity.projectId, projectId));
		const values = current
			? { ...dependencies, version: current.version + 1, updatedAt: new Date() }
			: dependencies;
		const [row] = await tx
			.insert(projectDependenciesEntity)
			.values({ projectId, ...values })
			.onConflictDoUpdate({ target: projectDependenciesEntity.projectId, set: values })
			.returning({
				version: projectDependenciesEntity.version,
				updatedAt: projectDependenciesEntity.updatedAt,
			});
		const artifact: DepsArtifact = {
			projectId,
			...dependencies,
			version: row!.version,
			updatedAt: row!.updatedAt.toISOString(),
		};
		afterCommit(
			() => putArtifactEverywhere(depsKey(projectId), artifact),
			"The project's npm packages were restored but not sent to the workers. Open Packages and install or remove one to send them.",
		);
	},
};
