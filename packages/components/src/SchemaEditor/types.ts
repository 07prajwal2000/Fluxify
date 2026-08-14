import type { ComponentType, ReactNode } from "react";

/**
 * The wire format is the one `apps/server/src/lib/validationSchemaZod.ts`
 * accepts and `schemaParser.ts` compiles to Zod. Anything this editor writes
 * that the parser does not read is dead weight, so the rule types below are
 * kept in step with `applyRules`.
 */
export type DataType =
	| "str"
	| "int"
	| "float"
	| "bool"
	| "object"
	| "arr"
	| "js"
	| "enum"
	| "file"
	| "blob";

export type ChainType = "or" | "and";

export interface Rule {
	type: string;
	value?: unknown;
	message?: string;
	[key: string]: unknown;
}

export interface SchemaProperty {
	/** Client-side only, for stable React keys. Round-trips harmlessly. */
	id?: string;
	key: string;
	dataType: DataType;
	rules?: Rule[];
	required?: boolean;
	/** For `object`. */
	properties?: SchemaProperty[];
	/** For `arr`. */
	items?: SchemaProperty;
	chain?: SchemaChain[];
	/** For `js` — the validator source. Not a rule; the parser reads it here. */
	js?: string;
}

export interface SchemaChain {
	chainType: ChainType;
	properties?: SchemaProperty[];
}

export interface ValidationSchema {
	dataType: DataType;
	properties?: SchemaProperty[];
	items?: SchemaProperty;
	chain?: SchemaChain[];
	rules?: Rule[];
	js?: string;
}

/**
 * Address of a node inside the schema tree. A number steps into
 * `properties[n]`, the literal `"items"` steps into an array's item schema.
 */
export type SchemaPath = (number | "items")[];

/** Any node the editor can sit on — the root has no `key`, a property does. */
export type SchemaNode = ValidationSchema | SchemaProperty;

export interface SchemaEditorRef {
	/** Fires `onSave` with the current schema. */
	save: () => void;
	getSchema: () => ValidationSchema;
}

/**
 * What a rule editor gets. Custom editors passed via `ruleEditors` receive the
 * same contract, so a third type of editor is a drop-in.
 */
export interface RuleEditorProps {
	node: SchemaNode;
	onUpdate: (updates: Partial<SchemaProperty>) => void;
	isReadOnly?: boolean;
	/** Visible lines for any embedded JavaScript editor. */
	jsEditorRows?: number;
}

export interface DataTypeOption {
	value: DataType;
	label: string;
}

export interface SchemaEditorProps {
	/** Controlled schema. Pair with `onChange`. */
	value?: ValidationSchema;
	/** Uncontrolled starting schema. */
	defaultValue?: ValidationSchema;
	/** Legacy alias for `defaultValue`. */
	initialData?: ValidationSchema;
	/** Fires on every edit. Required for controlled use. */
	onChange?: (schema: ValidationSchema) => void;
	/** Fires when `ref.save()` is called. */
	onSave?: (schema: ValidationSchema) => void;

	/** Field label rendered above the tabs. */
	label?: ReactNode;
	/** Helper text under the label. */
	description?: ReactNode;

	/** Everything becomes non-editable; navigation and preview still work. */
	isReadOnly?: boolean;
	/** Alias for `isReadOnly`. */
	readOnly?: boolean;
	/** Legacy alias for `isReadOnly`. */
	locked?: boolean;

	/** Restricts the type dropdown everywhere. Defaults to all types. */
	allowedDataTypes?: DataType[];
	/** Restricts the root type dropdown. Defaults to `allowedDataTypes`. */
	allowedRootTypes?: DataType[];
	/**
	 * Per-field override of the allowed types, keyed by dotted path
	 * (`user.address.zip`, `tags[]`). Wins over `allowedDataTypes`, and over
	 * `isReadOnly` for that one dropdown — the point is to let a locked schema
	 * still offer a choice where one is meaningful.
	 */
	typeOverrides?: Record<string, DataType[]>;

	/**
	 * Keys are fixed: no adding, removing or renaming properties, and every one
	 * of them stays required. Types and rules are still editable. For a schema
	 * whose keys come from somewhere else — path params are declared by the
	 * route path, not by this editor, and a declared one always has a value.
	 */
	lockKeys?: boolean;
	/** Drops the `js` type and the Custom JS tab. */
	disableJs?: boolean;
	/** Show the Preview tab. Default true. */
	showPreview?: boolean;
	/** Show the root type dropdown. Default true. */
	showRootTypeSelector?: boolean;
	/**
	 * How deep `object`/`arr` may nest, counting the root as 0. Beyond it those
	 * types drop out of the dropdown rather than silently allowing a tree the
	 * consumer cannot handle.
	 */
	maxDepth?: number;

	/**
	 * Replaces or extends the per-type rule editors. Merged over the defaults,
	 * so `{ str: MyStringRules }` swaps one and keeps the rest.
	 */
	ruleEditors?: Partial<Record<DataType, ComponentType<RuleEditorProps>>>;
	/** Visible lines for embedded JavaScript editors. Default 12. */
	jsEditorRows?: number;
	/** Labels for the type dropdown, merged over the defaults. */
	dataTypeLabels?: Partial<Record<DataType, string>>;

	className?: string;
}
