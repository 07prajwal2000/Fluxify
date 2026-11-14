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

	async import({ tx, projectId, afterCommit }, { dependencies }) {
		if (!dependencies) return;
		const [row] = await tx
			.insert(projectDependenciesEntity)
			.values({ projectId, ...dependencies })
			.returning({ updatedAt: projectDependenciesEntity.updatedAt });
		const artifact: DepsArtifact = {
			projectId,
			...dependencies,
			updatedAt: row!.updatedAt.toISOString(),
		};
		afterCommit(
			() => putArtifactEverywhere(depsKey(projectId), artifact),
			"The project's npm packages were restored but not sent to the workers. Open Packages and install or remove one to send them.",
		);
	},
};
