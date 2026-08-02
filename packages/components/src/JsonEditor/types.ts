import type { CSSProperties, ReactNode } from "react";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

export type JsonObject = { [key: string]: JsonValue };

export type JsonArray = JsonValue[];

export type JsonContainer = JsonObject | JsonArray;

export type JsonValueType =
	| "string"
	| "number"
	| "boolean"
	| "object"
	| "array"
	| "null";

export type JsonRootType = Extract<JsonValueType, "object" | "array">;

export type JsonEditorMode = "inline" | "modal";

export type JsonEditorModalSize = "xs" | "sm" | "md" | "lg" | "cover" | "full";

export interface JsonEditorBaseProps {
	/** Controlled JSON value. When omitted, the editor manages its own value. */
	value?: JsonContainer;
	/** Initial value for an uncontrolled editor. */
	defaultValue?: JsonContainer;
	/** Root value used when neither value prop is supplied. */
	rootType?: JsonRootType;
	/** Receives committed values. Inline changes commit immediately; modal changes commit on Save. */
	onChange?: (value: JsonContainer) => void;
	label?: ReactNode;
	description?: ReactNode;
	errorMessage?: ReactNode;
	isDisabled?: boolean;
	isReadOnly?: boolean;
	/** Enables the existing `js:` expression convention for string values. Defaults to true. */
	allowExpressions?: boolean;
	/** Enables the structured/preview tabs. */
	showPreview?: boolean;
	className?: string;
}

export interface JsonEditorInlineProps extends JsonEditorBaseProps {
	mode?: "inline";
}

export interface JsonEditorModalProps extends JsonEditorBaseProps {
	mode: "modal";
	triggerLabel?: ReactNode;
	modalTitle?: ReactNode;
	/** Fixed dialog width. Accepts CSS dimensions or pixel numbers. */
	modalWidth?: CSSProperties["width"];
	/** Fixed dialog height. Accepts CSS dimensions or pixel numbers. */
	modalHeight?: CSSProperties["height"];
	modalSize?: JsonEditorModalSize;
	saveLabel?: ReactNode;
	cancelLabel?: ReactNode;
	/** Controlled modal state. */
	isOpen?: boolean;
	/** Initial modal state when uncontrolled. */
	defaultOpen?: boolean;
	onOpenChange?: (isOpen: boolean) => void;
	onSave?: (value: JsonContainer) => void;
	triggerClassName?: string;
}

export type JsonEditorProps = JsonEditorInlineProps | JsonEditorModalProps;
