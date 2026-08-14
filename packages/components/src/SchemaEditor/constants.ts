import type { DataType, ValidationSchema } from "./types";

export const DATA_TYPE_LABELS: Record<DataType, string> = {
	str: "String",
	int: "Integer",
	float: "Float",
	bool: "Boolean",
	arr: "Array",
	object: "Object",
	enum: "Enum",
	file: "File",
	blob: "Binary (Blob)",
	js: "Write JavaScript",
};

/** Dropdown order. Also the default `allowedDataTypes`. */
export const ALL_DATA_TYPES: DataType[] = [
	"str",
	"int",
	"float",
	"bool",
	"arr",
	"object",
	"enum",
	"file",
	"blob",
	"js",
];

/** Types that can hold children, and so consume a level of `maxDepth`. */
export const CONTAINER_TYPES: DataType[] = ["object", "arr"];

/** A root schema is a shape to validate; `js` at the root is its own tab. */
export const ROOT_EXCLUDED_TYPES: DataType[] = ["js"];

export const DEFAULT_JS = "return true;";

export const DEFAULT_SCHEMA: ValidationSchema = {
	dataType: "object",
	properties: [],
};
