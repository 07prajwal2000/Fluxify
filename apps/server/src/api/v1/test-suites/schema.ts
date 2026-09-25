import { z } from "zod";

// --- Assertions Schema --- //
export const assertionSchema = z
	.object({
		target: z.enum(["status", "body", "time", "header", "customJs"]),
		propertyPath: z.string().optional().nullable(),
		operator: z
			.enum(["eq", "neq", "lt", "gt", "contains", "true", "false", "exists", "not_exists"])
			.optional()
			.nullable(),
		expectedValue: z.string().optional().nullable(),
		customJs: z.string().optional().nullable(),
	})
	.superRefine((val, ctx) => {
		// 1. Property path: a body path, or the header name for `header`
		if (
			val.target !== "body" &&
			val.target !== "header" &&
			val.propertyPath != null &&
			val.propertyPath !== ""
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["propertyPath"],
				message: "propertyPath must be absent or null unless target is 'body' or 'header'",
			});
		}

		// 2. Operators mapping
		const operatorsForTarget: Record<string, string[]> = {
			status: ["eq", "neq", "lt", "gt"],
			time: ["eq", "neq", "lt", "gt"],
			body: ["eq", "neq", "contains", "true", "false", "exists", "not_exists"],
			header: ["eq", "neq", "contains", "true", "false", "exists", "not_exists"],
		};

		if (val.target !== "customJs") {
			if (!val.operator) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["operator"],
					message: "Operator is required",
				});
			} else if (!operatorsForTarget[val.target]?.includes(val.operator)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["operator"],
					message: `Operator '${val.operator}' is not allowed for target '${val.target}'`,
				});
			}

			if (
				val.expectedValue == null &&
				val.operator !== "true" &&
				val.operator !== "false" &&
				val.operator !== "exists" &&
				val.operator !== "not_exists"
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					path: ["expectedValue"],
					message: "Expected value is required",
				});
			}
		}
	});

/** a hook body: a script, or JSON text that is the block's made-up output */
export const hookBodySchema = z
	.object({ kind: z.enum(["script", "json"]), value: z.string() })
	.superRefine((val, ctx) => {
		if (val.kind !== "json") return;
		try {
			JSON.parse(val.value);
		} catch {
			ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Invalid JSON" });
		}
	});

export const blockHookSchema = z.object({
	blockId: z.string(),
	onBefore: hookBodySchema.nullish(),
	onAfter: hookBodySchema.nullish(),
});

export const testSuiteCoreSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional().nullable(),
	routeId: z.uuid("Invalid route ID"),
	projectId: z.uuid("Invalid project ID"),
	params: z.record(z.string(), z.string()).default({}),
	headers: z.record(z.string(), z.string()).default({}),
	queryParams: z.record(z.string(), z.string()).default({}),
	routeParams: z.record(z.string(), z.string()).default({}),
	body: z.record(z.string(), z.unknown()).optional().nullable(),
	assertions: z.array(assertionSchema).default([]),
	appConfigOverrides: z
		.array(z.object({ key: z.string(), value: z.string() }))
		.default([])
		.optional()
		.nullable(),
	integrationOverrides: z
		.array(z.object({ existingId: z.string(), newId: z.string() }))
		.default([])
		.optional()
		.nullable(),
	/** replaces all of the suite's block hooks when sent (#483) */
	hooks: z.array(blockHookSchema).optional(),
});
