import z from "zod";
import { conditionSchema } from "@fluxify/lib";
import { blockAiDescriptions } from "./blockAiDescriptions";
import { dbConditionSideSchema, whereConditionSchema } from "./db/schema";

type JsonSchema = Record<string, any>;

/**
 * Renders a block's JSON Schema as a TypeScript-shaped contract.
 *
 * The catalogue in the block builder's system prompt is JSON Schema because
 * that is what `z.toJSONSchema()` hands back, not because the model reads it
 * better — and JSON Schema spends most of its characters on structure the
 * model already infers (`"type": "string"` for a field whose value is plainly
 * a string, a `required` array restating what the absence of `?` says). The
 * same 29 contracts in this shape cost roughly a third of the tokens.
 *
 * Derived rather than hand-written on purpose: the source of truth stays the
 * zod schema the block actually validates against, so `.describe()` text and
 * enum members cannot drift away from what the block accepts at runtime.
 */

/** Fields every block inherits from `baseBlockDataSchema`. Stating them 29
 * times tells the model nothing it did not learn the first time. */
const BASE_FIELDS = new Set(["blockName", "blockDescription"]);

/**
 * Schemas shared by more than one block, hoisted so the contract is stated
 * once and referenced by name. Order is dependency order — an entry may only
 * reference names declared above it, because each is rendered against the
 * types registered before it.
 */
const SHARED_TYPES: Array<[string, z.ZodType]> = [
	["DbConditionSide", dbConditionSideSchema as unknown as z.ZodType],
	["DbWhereCondition", whereConditionSchema as unknown as z.ZodType],
	["Condition", conditionSchema as unknown as z.ZodType],
];

/** Identity of a schema's *shape*, ignoring the prose wrapped around it: the
 * same condition type carries a different `.describe()` at each use site. */
const shapeKey = (schema: JsonSchema): string =>
	JSON.stringify(schema, (key, value) =>
		key === "$schema" || key === "description" ? undefined : value,
	);

const sharedNames = new Map<string, string>();

function typeOf(schema: JsonSchema, indent: string): string {
	// An empty schema constrains nothing — that is `z.any()`, not `z.object()`,
	// which still emits `{ type: "object" }` and lands in the switch below.
	if (!schema || Object.keys(schema).length === 0) return "any";

	const shared = sharedNames.get(shapeKey(schema));
	if (shared) return shared;

	if (schema.const !== undefined) return JSON.stringify(schema.const);
	if (Array.isArray(schema.enum)) {
		return schema.enum.map((value: unknown) => JSON.stringify(value)).join(" | ");
	}

	// zod emits `oneOf` for a discriminated union and `anyOf` for a plain one.
	const union: JsonSchema[] | undefined = schema.oneOf ?? schema.anyOf;
	if (union) return renderUnion(union, indent);

	switch (schema.type) {
		case "string":
			return "string";
		case "number":
		case "integer":
			return "number";
		case "boolean":
			return "boolean";
		case "null":
			return "null";
		case "array":
			return `${typeOf(schema.items ?? {}, indent)}[]`;
		case "object": {
			if (schema.properties && Object.keys(schema.properties).length) {
				return renderObject(schema, indent, false);
			}
			// `z.record(z.string(), T)` types its values through additionalProperties.
			const values = schema.additionalProperties;
			if (values && typeof values === "object") {
				return `Record<string, ${typeOf(values, indent)}>`;
			}
			return "object";
		}
		default:
			return "any";
	}
}

function renderUnion(members: JsonSchema[], indent: string): string {
	const rendered = members.map((member) => typeOf(member, indent));
	// Object members render across several lines; a one-line `A | B` join
	// makes those unreadable, so give each its own arm instead.
	return rendered.some((member) => member.includes("\n"))
		? rendered.join(`\n${indent}| `)
		: rendered.join(" | ");
}

function renderObject(
	schema: JsonSchema,
	indent: string,
	dropBaseFields: boolean,
): string {
	const properties: JsonSchema = schema.properties ?? {};
	const required = new Set<string>(schema.required ?? []);
	const inner = `${indent}\t`;
	const lines: string[] = [];

	for (const [name, raw] of Object.entries(properties)) {
		if (dropBaseFields && BASE_FIELDS.has(name)) continue;
		const property = raw as JsonSchema;

		const notes: string[] = [];
		if (property.description) notes.push(property.description);
		if (property.default !== undefined) {
			notes.push(`default ${JSON.stringify(property.default)}`);
		}

		const optional = required.has(name) ? "" : "?";
		const comment = notes.length ? `  // ${notes.join("; ")}` : "";
		lines.push(`${inner}${name}${optional}: ${typeOf(property, inner)};${comment}`);
	}

	if (!lines.length) return "{}";
	return `{\n${lines.join("\n")}\n${indent}}`;
}

/** Renders one block's JSON Schema (the string form stored on its AI
 *  description, or an already-parsed object) as a compact contract body. */
export function renderCompactSchema(jsonSchema: string | JsonSchema): string {
	const parsed =
		typeof jsonSchema === "string" ? JSON.parse(jsonSchema) : jsonSchema;
	return renderObject(parsed, "", true);
}

/** `type X = ...` declarations for every shared schema, in dependency order.
 *  Registering each only after it is rendered is what stops a type from
 *  collapsing into a reference to itself. */
export const COMPACT_SHARED_TYPES: string = SHARED_TYPES.map(
	([name, schema]) => {
		const jsonSchema = z.toJSONSchema(schema) as JsonSchema;
		// Through `typeOf`, not `renderObject`: a shared type is not always an
		// object — `dbConditionSideSchema` is a union at its top level.
		const body = typeOf(jsonSchema, "");
		sharedNames.set(shapeKey(jsonSchema), name);
		return `type ${name} = ${body}`;
	},
).join("\n\n");

/** Drop-in replacement for `BUILTIN_BLOCK_SCHEMAS_REFERENCE`: the same 29
 *  contracts, shared types stated once, in one fence rather than 29. */
export const COMPACT_BLOCK_SCHEMAS_REFERENCE: string = [
	COMPACT_SHARED_TYPES,
	...blockAiDescriptions
		.filter(
			(block): block is (typeof blockAiDescriptions)[number] & { jsonSchema: string } =>
				typeof block.jsonSchema === "string" && block.jsonSchema.length > 0,
		)
		.map(({ name, jsonSchema }) => {
			const body = renderCompactSchema(jsonSchema);
			return `${name} ${body === "{}" ? "{} // no configuration" : body}`;
		}),
].join("\n\n");

// `bun run builtin/compactSchemas.ts` prints the reference and what it saves.
// Guarded on argv rather than `import.meta.main` because this package compiles
// under a module target that rejects `import.meta`.
if (process.argv[1]?.endsWith("compactSchemas.ts")) {
	const before = blockAiDescriptions.reduce(
		(total, block) => total + (block.jsonSchema?.length ?? 0),
		0,
	);
	const after = COMPACT_BLOCK_SCHEMAS_REFERENCE.length;
	console.log(COMPACT_BLOCK_SCHEMAS_REFERENCE);
	console.log(
		`\n--- json schema ${before} chars | compact ${after} chars | ${Math.round(
			(1 - after / before) * 100,
		)}% smaller`,
	);
}
