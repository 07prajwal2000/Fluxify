import z from "zod";
import { RESOURCE_TYPES } from "../../../modules/transfer/registry";

export const resourceParamSchema = z.object({ resourceType: z.enum(RESOURCE_TYPES) });

export const exportParamSchema = resourceParamSchema.extend({ id: z.uuidv7() });

export const exportQuerySchema = z.object({
	/** leave the test suites out of the file with `false` */
	includeTests: z
		.enum(["true", "false"])
		.default("true")
		.transform((v) => v === "true"),
});

export const importBodySchema = z.object({
	projectId: z.uuidv7(),
	/** the file an export produced; checked in full against the resource type */
	bundle: z.record(z.string(), z.unknown()),
});

export const importResultSchema = z.object({
	id: z.uuidv7(),
	/** what the import had to leave out or could not restore */
	warnings: z.array(z.string()),
});

export const importCheckResultSchema = z.object({
	/** what an import would clash with in the project */
	taken: z.array(z.enum(["name", "path"])),
});
