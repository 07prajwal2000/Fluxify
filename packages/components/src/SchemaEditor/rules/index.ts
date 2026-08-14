import type { ComponentType } from "react";
import type { DataType, RuleEditorProps } from "../types";
import { ArrayRules } from "./ArrayRules";
import { EnumRules } from "./EnumRules";
import { FileRules } from "./FileRules";
import { JsRules } from "./JsRules";
import { NumberRules } from "./NumberRules";
import { StringRules } from "./StringRules";

/**
 * Which editor configures which type. Consumers override entries through the
 * `ruleEditors` prop; a type absent from this map simply has nothing to
 * configure (`bool`, and `object` whose children are edited inline).
 */
export const DEFAULT_RULE_EDITORS: Partial<
	Record<DataType, ComponentType<RuleEditorProps>>
> = {
	str: StringRules,
	int: NumberRules,
	float: NumberRules,
	arr: ArrayRules,
	enum: EnumRules,
	file: FileRules,
	blob: FileRules,
	js: JsRules,
};

export { ArrayRules, EnumRules, FileRules, JsRules, NumberRules, StringRules };
export { RuleNumberField, RuleSectionTitle, RuleTextField } from "./fields";
