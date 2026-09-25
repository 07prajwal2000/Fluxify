import type { ApiSchemaProperty, ApiSchemaRule } from "./types";

function checkStringRules(s: string, rules: ApiSchemaRule[]): string | null {
	for (const rule of rules) {
		const msg = rule.message;
		if (rule.type === "minLength" && rule.value != null && s.length < Number(rule.value)) {
			return msg ?? `Must be at least ${rule.value} characters`;
		}
		if (rule.type === "maxLength" && rule.value != null && s.length > Number(rule.value)) {
			return msg ?? `Must be at most ${rule.value} characters`;
		}
		if (rule.type === "regex" && rule.value) {
			try {
				if (!new RegExp(String(rule.value)).test(s))
					return msg ?? `Must match pattern ${rule.value}`;
			} catch {
				// ignore invalid regex
			}
		}
		if (rule.type === "startsWith" && rule.value && !s.startsWith(String(rule.value)))
			return msg ?? `Must start with "${rule.value}"`;
		if (rule.type === "endsWith" && rule.value && !s.endsWith(String(rule.value)))
			return msg ?? `Must end with "${rule.value}"`;
		if (rule.type === "contains" && rule.value && !s.includes(String(rule.value)))
			return msg ?? `Must contain "${rule.value}"`;
		if (rule.type === "notContains" && rule.value && s.includes(String(rule.value)))
			return msg ?? `Must not contain "${rule.value}"`;
	}
	return null;
}

function checkNumberRules(num: number, rules: ApiSchemaRule[]): string | null {
	for (const rule of rules) {
		const msg = rule.message;
		if (rule.type === "min" && rule.value != null && num < Number(rule.value))
			return msg ?? `Must be at least ${rule.value}`;
		if (rule.type === "max" && rule.value != null && num > Number(rule.value))
			return msg ?? `Must be at most ${rule.value}`;
	}
	return null;
}

function checkArrayRules(arr: unknown[], rules: ApiSchemaRule[]): string | null {
	for (const rule of rules) {
		const msg = rule.message;
		if (rule.type === "minItems" && rule.value != null && arr.length < Number(rule.value))
			return msg ?? `Must contain at least ${rule.value} items`;
		if (rule.type === "maxItems" && rule.value != null && arr.length > Number(rule.value))
			return msg ?? `Must contain at most ${rule.value} items`;
	}
	return null;
}

function checkFileRules(val: unknown, rules: ApiSchemaRule[]): string | null {
	const fileObj = val as { size?: number };
	if (typeof fileObj?.size === "number") {
		for (const rule of rules) {
			const msg = rule.message;
			if (rule.type === "maxSize" && rule.value != null && fileObj.size > Number(rule.value))
				return msg ?? `Must be at most ${rule.value} bytes`;
			if (rule.type === "minSize" && rule.value != null && fileObj.size < Number(rule.value))
				return msg ?? `Must be at least ${rule.value} bytes`;
		}
	}
	return null;
}

export function validatePropertyValue(
	val: unknown,
	prop: ApiSchemaProperty,
	options: { coerce?: boolean; isPathParam?: boolean } = {},
): string | null {
	const { coerce = false, isPathParam = false } = options;

	const isMissing =
		val === undefined || val === null || (typeof val === "string" && val.trim() === "");
	if (isMissing) {
		return prop.required || isPathParam
			? isPathParam
				? "Route parameter is required"
				: "Field is required"
			: null;
	}

	const rawType = (prop.dataType ?? "").toLowerCase();

	if (rawType === "int" || rawType === "integer") {
		if (coerce || typeof val === "string") {
			if (!/^-?\d+$/.test(String(val).trim())) return "Must be an integer";
		} else if (typeof val !== "number" || !Number.isInteger(val)) {
			return "Must be an integer";
		}
	} else if (rawType === "float" || rawType === "number") {
		const s = String(val).trim();
		if ((coerce || typeof val === "string") && (isNaN(Number(s)) || s === ""))
			return "Must be a number";
		if (!coerce && typeof val !== "number" && typeof val !== "string") return "Must be a number";
	} else if (rawType === "bool" || rawType === "boolean") {
		if (coerce || typeof val === "string") {
			const s = String(val).trim().toLowerCase();
			if (s !== "true" && s !== "false" && s !== "1" && s !== "0")
				return "Must be a boolean (true or false)";
		} else if (typeof val !== "boolean") {
			return "Must be a boolean";
		}
	} else if (rawType === "arr" || rawType === "array") {
		if (!Array.isArray(val)) return "Must be an array";
		// e.g. each file of a `file[]` field against its own maxSize
		if (prop.items) {
			for (const [index, item] of val.entries()) {
				const err = validatePropertyValue(item, prop.items, options);
				if (err) return `Item ${index + 1}: ${err}`;
			}
		}
	} else if (rawType === "object") {
		if (typeof val !== "object" || val === null || Array.isArray(val)) return "Must be an object";
	} else if (rawType === "enum") {
		const enumRule = prop.rules?.find((r) => r.type === "values" || r.type === "enum");
		const allowed = Array.isArray(enumRule?.value) ? enumRule.value : [];
		if (allowed.length > 0 && !allowed.some((item) => String(item) === String(val).trim())) {
			return `Must be one of: ${allowed.join(", ")}`;
		}
	}

	if (prop.rules && Array.isArray(prop.rules)) {
		if (rawType === "str" || rawType === "string" || typeof val === "string") {
			const err = checkStringRules(String(val), prop.rules);
			if (err) return err;
		}
		if (
			rawType === "int" ||
			rawType === "integer" ||
			rawType === "float" ||
			rawType === "number" ||
			!isNaN(Number(val))
		) {
			const err = checkNumberRules(Number(val), prop.rules);
			if (err) return err;
		}
		if (Array.isArray(val)) {
			const err = checkArrayRules(val, prop.rules);
			if (err) return err;
		}
		const err = checkFileRules(val, prop.rules);
		if (err) return err;
	}

	return null;
}
