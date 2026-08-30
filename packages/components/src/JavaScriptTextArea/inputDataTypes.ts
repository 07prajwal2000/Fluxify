import { useEffect, useMemo } from "react";
import type { DataType, SchemaProperty, ValidationSchema } from "../SchemaEditor/types";

/**
 * Types `getRequestBody()` from the schema the data is validated against.
 *
 * The runtime hands a graph whatever it was given — a request body on a route,
 * the payload on a workflow run — and until now that arrived in the editor as
 * `any`, so every property was typed from memory. The schema already says what
 * the shape is; this turns it into the declaration Monaco reads.
 *
 * It merges into the `FluxifyInputData` interface the static globals declare,
 * rather than redeclaring the function: two declarations of one function are
 * overloads whose order across ambient files is not ours to control, and the
 * wrong one winning would be worse than no types at all.
 */
const ID = "fluxify-input-data";
const VIRTUAL_PATH = "file:///fluxify-input-data.d.ts";

const PRIMITIVES: Partial<Record<DataType, string>> = {
	str: "string",
	int: "number",
	float: "number",
	bool: "boolean",
	// a file arrives as an upload object, a blob as bytes; neither has a shape
	// worth spelling out here
	file: "unknown",
	blob: "unknown",
	// `js` is a custom validator, so the value it guards can be anything
	js: "any",
};

const quote = (value: unknown) => JSON.stringify(String(value));

/** Enum values live in the `values` rule, stored as their real type. */
function enumType(node: { rules?: { type: string; value?: unknown }[] }): string {
	const values = node.rules?.find((rule) => rule.type === "values")?.value;
	if (!Array.isArray(values) || values.length === 0) return "string | number";
	return [...new Set(values)]
		.map((value) => (typeof value === "number" ? String(value) : quote(value)))
		.join(" | ");
}

function typeOf(node: SchemaProperty | ValidationSchema, depth: number): string {
	// a schema deep enough to hit this is either generated or a mistake, and a
	// cycle would hang the editor rather than fail it
	if (depth > 8) return "any";
	switch (node.dataType) {
		case "object":
			return objectType(node.properties, depth);
		case "arr":
			return node.items ? `${typeOf(node.items, depth + 1)}[]` : "any[]";
		case "enum":
			return enumType(node);
		default:
			return PRIMITIVES[node.dataType] ?? "any";
	}
}

function objectType(properties: SchemaProperty[] | undefined, depth: number): string {
	const members = (properties ?? [])
		.filter((property) => property?.key)
		.map((property) => {
			const key = /^[A-Za-z_$][\w$]*$/.test(property.key)
				? property.key
				: quote(property.key);
			// an optional field is genuinely absent, and saying so is the whole
			// value of typing this at all
			const optional = property.required ? "" : "?";
			return `${key}${optional}: ${typeOf(property, depth + 1)};`;
		});
	return members.length > 0 ? `{\n${members.join("\n")}\n}` : "{ [key: string]: any }";
}

/**
 * The declaration merged into `FluxifyInputData`, or `""` when the schema
 * describes nothing — an empty interface would take away the free-form access
 * the globals' index signature allows.
 */
export function buildInputDataTypeLib(schema: ValidationSchema | null | undefined): string {
	if (!schema) return "";
	// only an object root has named members to merge; a bare string or array
	// payload is read whole, and there is nothing to complete on it
	if (schema.dataType !== "object") return "";
	const members = (schema.properties ?? []).filter((property) => property?.key);
	if (members.length === 0) return "";
	return `/** The data this run was given, as its schema describes it. */\ndeclare interface FluxifyInputData ${objectType(
		members,
		0,
	)}\n`;
}

/**
 * Registers the shape for as long as the component is mounted. The registry is
 * imported lazily on purpose: it pulls in Monaco, which the editor itself only
 * loads when one is actually opened.
 */
export function useInputDataTypes(schema: ValidationSchema | null | undefined) {
	const lib = useMemo(() => buildInputDataTypeLib(schema), [schema]);

	useEffect(() => {
		if (!lib) return;
		let live = true;
		const registry = import("./typeLibRegistry");
		void registry.then((module) => {
			if (live) module.registerTypeLib(ID, lib, VIRTUAL_PATH);
		});
		return () => {
			live = false;
			void registry.then((module) => module.unregisterTypeLib(ID));
		};
	}, [lib]);
}
