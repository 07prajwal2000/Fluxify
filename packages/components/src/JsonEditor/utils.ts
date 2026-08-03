import type {
	JsonArray,
	JsonContainer,
	JsonObject,
	JsonRootType,
	JsonValue,
	JsonValueType,
} from "./types";

export function getJsonValueType(value: JsonValue): JsonValueType {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	return typeof value as Exclude<JsonValueType, "array" | "null">;
}

export function createDefaultJsonValue(type: JsonValueType): JsonValue {
	switch (type) {
		case "string":
			return "";
		case "number":
			return 0;
		case "boolean":
			return false;
		case "object":
			return {};
		case "array":
			return [];
		case "null":
			return null;
	}
}

export function createDefaultJsonRoot(type: JsonRootType = "object"): JsonContainer {
	return type === "array" ? [] : {};
}

export function formatJson(value: JsonValue, indent = 2): string {
	return JSON.stringify(value, null, indent);
}

export function getUniqueObjectKey(value: JsonObject, prefix = "key"): string {
	if (!(prefix in value)) return prefix;

	let suffix = 2;
	while (`${prefix}${suffix}` in value) suffix += 1;
	return `${prefix}${suffix}`;
}

/** Renames a property without changing its position in the object. */
export function renameObjectKey(
	value: JsonObject,
	currentKey: string,
	nextKey: string,
): JsonObject {
	if (currentKey === nextKey || !(currentKey in value)) return value;
	if (nextKey in value) return value;

	return Object.fromEntries(
		Object.entries(value).map(([key, entryValue]) => [
			key === currentKey ? nextKey : key,
			entryValue,
		]),
	) as JsonObject;
}

export function moveArrayItem(
	value: JsonArray,
	fromIndex: number,
	toIndex: number,
): JsonArray {
	if (
		fromIndex === toIndex ||
		fromIndex < 0 ||
		toIndex < 0 ||
		fromIndex >= value.length ||
		toIndex >= value.length
	) {
		return value;
	}

	const next = [...value];
	const [item] = next.splice(fromIndex, 1);
	if (item === undefined) return value;
	next.splice(toIndex, 0, item);
	return next;
}

