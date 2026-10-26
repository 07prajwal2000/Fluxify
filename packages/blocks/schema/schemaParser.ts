import type { z } from "zod";
import { type ParserContext, validationContext } from "./buildZodSchema";
import { cachedZod } from "./schemaCache";

export type { ParserContext };

export class ValidationError extends Error {
	payload: any;
	constructor(payload: any) {
		super("Validation failed");
		this.name = "ValidationError";
		this.payload = payload;
	}
}

export type CompiledRequestSchema = {
	validate(requestData: any, context: ParserContext): Promise<ParseResult>;
};

type ParseResult = {
	success: boolean;
	/** coerced input with defaults filled in; only set on success */
	data?: unknown;
	errors?: Array<{ path: string; property: string; errors: any[] }>;
};

function formatResult(result: z.ZodSafeParseResult<unknown>): ParseResult {
	if (result.success) return { success: true, data: result.data };
	const errors = result.error.issues.map((issue) => {
		let customErrorObj = null;
		try {
			customErrorObj = JSON.parse(issue.message);
		} catch {
			// Not a JSON string (standard zod error message).
		}
		return {
			path: issue.path.join("."),
			property: issue.path[issue.path.length - 1]?.toString() || "",
			errors: customErrorObj ? [customErrorObj] : [issue.message],
		};
	});
	return { success: false, errors };
}

/** Compile the definition once at artifact load, then validate many requests. */
export function compileRequestSchema(
	schemaJson: any,
	{ coerce = false }: Pick<ParserContext, "coerce"> = {},
): CompiledRequestSchema {
	// an invalid definition (checked against the DB Zod schema) is not cached
	const executableSchema = cachedZod(schemaJson, coerce);
	if (!executableSchema) {
		return {
			async validate() {
				return {
					success: false,
					errors: [
						{ path: "schema", property: "schema", errors: ["Invalid schema definition format"] },
					],
				};
			},
		};
	}

	// only a JS rule is async and reads the request's vars; without one the sync parse
	// skips zod's async machinery and the async-local run on every request (#944)
	if (!hasJsRule(schemaJson)) {
		return {
			async validate(requestData: any) {
				return formatResult(executableSchema.safeParse(requestData));
			},
		};
	}

	return {
		async validate(requestData: any, context: ParserContext): Promise<ParseResult> {
			// A cached schema is shared by concurrent requests. The JS refinement reads
			// its own async-local context, so parallel requests cannot leak vars.
			return validationContext.run(context, async () =>
				formatResult(await executableSchema.safeParseAsync(requestData)),
			);
		},
	};
}

/** a `js` node anywhere in the definition (properties, items, chains); a false hit only costs the async path */
function hasJsRule(def: unknown): boolean {
	if (!def || typeof def !== "object") return false;
	if ((def as { dataType?: unknown }).dataType === "js") return true;
	return Object.values(def).some(hasJsRule);
}

export const parseRequestSchema = async (
	schemaJson: any,
	requestData: any,
	context: ParserContext,
) => {
	return compileRequestSchema(schemaJson, context).validate(requestData, context);
};
