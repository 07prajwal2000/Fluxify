import { z } from "zod";
import { CONTENT_TYPES } from "../../../lib/routeConfig";
import { toCases } from "../../../modules/testRunner/cases";

// --- Assertions Schema --- //
export const assertionSchema = z
	.object({
		target: z.enum([
			"status",
			"body",
			"time",
			"header",
			"customJs",
			// workflow suites (#487): the run's `{ successful, output, error }`
			"output",
			"successful",
		]),
		propertyPath: z.string().optional().nullable(),
		operator: z
			.enum(["eq", "neq", "lt", "gt", "contains", "true", "false", "exists", "not_exists"])
			.optional()
			.nullable(),
		expectedValue: z.string().optional().nullable(),
		customJs: z.string().optional().nullable(),
	})
	.superRefine((val, ctx) => {
		// 1. Property path: a body or output path, or the header name for `header`
		if (
			!["body", "output", "header"].includes(val.target) &&
			val.propertyPath != null &&
			val.propertyPath !== ""
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["propertyPath"],
				message:
					"propertyPath must be absent or null unless target is 'body', 'output' or 'header'",
			});
		}

		// 2. Operators mapping
		const operatorsForTarget: Record<string, string[]> = {
			status: ["eq", "neq", "lt", "gt"],
			time: ["eq", "neq", "lt", "gt"],
			body: ["eq", "neq", "contains", "true", "false", "exists", "not_exists"],
			header: ["eq", "neq", "contains", "true", "false", "exists", "not_exists"],
			output: ["eq", "neq", "contains", "true", "false", "exists", "not_exists"],
			successful: ["true", "false"],
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

/** ~1MB of file once base64 grows it by a third */
const MAX_BODY_CHARS = 1_400_000;

const tooLarge = (value: unknown) => JSON.stringify(value ?? null).length > MAX_BODY_CHARS;

/** what a workflow suite feeds the workflow (#487); see `SuiteInput` */
export const suiteInputSchema = z
	.object({
		source: z.enum(["raw", "script", "loader"]),
		mode: z.enum(["single", "cases"]),
		raw: z.unknown().optional(),
		script: z.string().optional(),
		loaderBlockId: z.string().nullish(),
		timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
	})
	.superRefine((val, ctx) => {
		if (tooLarge(val)) {
			ctx.addIssue({ code: "custom", path: ["raw"], message: "Input is too large (1MB max)." });
		}
		// a script or loader list is only known at run time; the runner checks it then
		if (val.source !== "raw" || val.mode !== "cases") return;
		try {
			toCases(val.raw ?? []);
		} catch (error) {
			ctx.addIssue({ code: "custom", path: ["raw"], message: (error as Error).message });
		}
	});

export const testSuiteCoreSchema = z.object({
	name: z.string().min(1, "Name is required"),
	description: z.string().optional().nullable(),
	/** one of the two is set: the route or the workflow the suite tests */
	routeId: z.string().nullish(),
	workflowId: z.string().nullish(),
	input: suiteInputSchema.nullish(),
	projectId: z.uuid("Invalid project ID"),
	params: z.record(z.string(), z.string()).default({}),
	headers: z.record(z.string(), z.string()).default({}),
	queryParams: z.record(z.string(), z.string()).default({}),
	routeParams: z.record(z.string(), z.string()).default({}),
	/** the body's format; null sends JSON */
	contentType: z.enum(CONTENT_TYPES).nullish(),
	/**
	 * JSON: any value. Form: field -> string, or a file as { name, type, base64 }
	 * (an array for several). Octet-stream: base64 text.
	 */
	body: z
		.unknown()
		.refine((body) => !tooLarge(body), {
			message: "Body is too large. Keep files under 1MB.",
		})
		.optional()
		.nullable(),
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
	/** test-only custom blocks run before / after the request (#483) */
	setupBlockId: z.string().nullish(),
	teardownBlockId: z.string().nullish(),
	setupTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
	teardownTimeoutMs: z.number().int().min(1_000).max(600_000).optional(),
	runAlone: z.boolean().optional(),
});
