import { useId } from "react";
import { cn, type DataType, type SchemaProperty, type ValidationSchema } from "@fluxify/components";
import { CONTENT_TYPES } from "@fluxify/server/src/lib/routeConfig";

/**
 * Everything the create wizard and the settings panel agree on. The two screens
 * differ only in layout — the rules about what a route may contain are the
 * server's, so they live in one place rather than being restated per screen.
 */

export const METHODS = ["GET", "POST", "PUT", "DELETE"] as const;
export type Method = (typeof METHODS)[number];

// only these carry a body — see the request body reader on the server
export const METHODS_WITH_BODY: readonly string[] = ["POST", "PUT"];

export const CONTENT_TYPE_OPTIONS = CONTENT_TYPES.map((value) => ({
	value,
	label: value,
}));

export const EMPTY_SCHEMA: ValidationSchema = { dataType: "object", properties: [] };

/** An octet-stream body has no fields — the body *is* the binary payload. */
export const BINARY_SCHEMA: ValidationSchema = { dataType: "blob" };

/** Types any body format can carry. */
const BODY_DATA_TYPES: DataType[] = [
	"str",
	"int",
	"float",
	"bool",
	"arr",
	"object",
	"enum",
	"js",
];

export const PARAM_DATA_TYPES: DataType[] = ["str", "int", "float", "bool", "enum"];
export const QUERY_DATA_TYPES: DataType[] = [
	"str",
	"int",
	"float",
	"bool",
	"arr",
	"enum",
];

export function isBinaryBody(contentTypes: string[]) {
	return (
		contentTypes.length === 1 && contentTypes[0] === "application/octet-stream"
	);
}

/**
 * A file only reaches the server in a multipart body — offering the type under
 * `application/json` just builds a schema no request can ever satisfy.
 */
export function bodyDataTypes(contentTypes: string[]): DataType[] {
	return contentTypes.includes("multipart/form-data")
		? [...BODY_DATA_TYPES, "file"]
		: BODY_DATA_TYPES;
}

/** Drops types the current content types can no longer carry. */
export function pruneDataTypes(
	schema: ValidationSchema,
	allowed: DataType[],
): ValidationSchema {
	const properties = (schema.properties ?? []).map((property) =>
		allowed.includes(property.dataType)
			? property
			: { ...property, dataType: "str" as const },
	);
	return { ...schema, properties };
}

/** The body schema a content-type change leaves behind. */
export function bodySchemaFor(
	schema: ValidationSchema,
	contentTypes: string[],
): ValidationSchema {
	if (isBinaryBody(contentTypes)) return BINARY_SCHEMA;
	return pruneDataTypes(
		schema.dataType === "blob" ? EMPTY_SCHEMA : schema,
		bodyDataTypes(contentTypes),
	);
}

/** Path variables declared in the path: "/users/:id/posts/:postId" => ["id", "postId"]. */
export function extractPathParams(path: string) {
	return Array.from(path.matchAll(/:([a-zA-Z0-9_]+)/g)).map((m) => m[1]);
}

/** Keeps typing inside what ROUTE_REGEX accepts instead of failing on submit. */
export function sanitizePath(next: string) {
	const cleaned = next.replace(/[^a-zA-Z0-9\-/:]/g, "").replace(/\/{2,}/g, "/");
	if (cleaned === "") return "";
	return cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
}

/** An empty object schema says nothing — anything else is worth sending. */
export function describesSomething(schema: ValidationSchema) {
	return schema.dataType !== "object" || (schema.properties ?? []).length > 0;
}

/**
 * The path is the only source of truth for which params exist, so the schema is
 * derived from it rather than edited — only types and rules are the user's. A
 * declared param always has a value, so `required` is not a choice.
 */
export function paramsSchemaFrom(
	pathParams: string[],
	config: Record<string, SchemaProperty>,
): ValidationSchema {
	return {
		dataType: "object",
		properties: pathParams.map((key) => ({
			...config[key],
			id: key,
			key,
			dataType: config[key]?.dataType ?? "str",
			required: true,
		})),
	};
}

/** Property config keyed by param name, so a path edit keeps what still applies. */
export function paramConfigFrom(schema: ValidationSchema | undefined | null) {
	return Object.fromEntries(
		(schema?.properties ?? []).map((property) => [property.key, property]),
	) as Record<string, SchemaProperty>;
}

/**
 * Segmented radio group. Native radios keep arrow keys, labels and focus for
 * free; the knob is just a sibling that slides to the selected index.
 */
export function MethodSwitch({
	value,
	onChange,
}: {
	value: Method;
	onChange: (method: Method) => void;
}) {
	// two switches on one page must not share a radio name, or they link up
	const name = useId();
	const index = METHODS.indexOf(value);
	return (
		<div
			role="radiogroup"
			aria-label="HTTP method"
			className="relative grid w-full max-w-sm grid-cols-4 rounded-full border border-border bg-background-secondary p-1"
		>
			<span
				aria-hidden
				className="absolute inset-y-1 left-1 rounded-full bg-accent transition-transform duration-300 ease-out"
				style={{
					width: "calc((100% - 0.5rem) / 4)",
					transform: `translateX(${index * 100}%)`,
				}}
			/>
			{METHODS.map((item) => (
				<label
					key={item}
					className={cn(
						"relative cursor-pointer select-none rounded-full py-1.5 text-center text-xs font-semibold transition-colors",
						"has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background-secondary",
						value === item ? "text-accent-foreground" : "text-muted hover:text-foreground",
					)}
				>
					<input
						type="radio"
						name={name}
						value={item}
						checked={value === item}
						onChange={() => onChange(item)}
						className="sr-only"
					/>
					{item}
				</label>
			))}
		</div>
	);
}
