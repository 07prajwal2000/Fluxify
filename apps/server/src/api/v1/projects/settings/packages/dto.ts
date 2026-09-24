import z from "zod";

const packageRow = z.object({
	name: z.string(),
	/** the range in package.json */
	range: z.string(),
	/** the version the lockfile pinned it to */
	version: z.string().nullable(),
});

export const packagesResponseSchema = z.object({
	/** bumps on every change; 0 means no packages were ever installed */
	version: z.number().int(),
	minReleaseAgeDays: z.number().int(),
	updatedAt: z.string().nullable(),
	packages: z.array(packageRow),
});

export const installRequestSchema = z.object({
	packages: z
		.array(z.object({ name: z.string().min(1).max(214), version: z.string().max(64).optional() }))
		.min(1)
		.max(50),
	/** allow these packages' install scripts to run on workers */
	trust: z.boolean().optional(),
});

export const removeRequestSchema = z.object({
	names: z.array(z.string().min(1).max(214)).min(1).max(50),
});

export const updatesResponseSchema = z.array(
	z.object({
		name: z.string(),
		current: z.string().nullable(),
		/** newest stable release the project's minimum release age allows */
		latest: z.string().nullable(),
		hasUpdate: z.boolean(),
	}),
);

const failedImport = z.object({ name: z.string(), error: z.string() });

export const statusResponseSchema = z.object({
	version: z.number().int(),
	/** every live node serving the project has settled on `version` */
	done: z.boolean(),
	nodes: z.array(
		z.object({
			nodeId: z.string(),
			type: z.string(),
			status: z
				.object({
					version: z.number().int(),
					state: z.enum(["installing", "ready", "failed"]),
					error: z.string().optional(),
					failedImports: z.array(failedImport).optional(),
				})
				.nullable(),
		}),
	),
});
