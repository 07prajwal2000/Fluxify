import type { DiagnosticSeverity } from "./types";

/** a value, a condition side (`{ kind, value }`) or a `js:` string with nothing in it */
export function isBlank(raw: unknown): boolean {
	if (raw && typeof raw === "object" && "value" in raw) return isBlank(raw.value);
	if (typeof raw === "number" || typeof raw === "boolean") return false;
	const text = typeof raw === "string" ? raw.trim() : "";
	return !(text.startsWith("js:") ? text.slice(3).trim() : text);
}

const VALUELESS = new Set(["is_null", "is_not_null", "exists", "not_exists"]);

const kindOf = (raw: unknown) =>
	raw && typeof raw === "object" && "kind" in raw ? raw.kind : undefined;

/**
 * what is wrong with a list of db where conditions, in the order the panel
 * shows them; a condition inside a group is numbered by its path, e.g. 2.1
 */
export function dbConditionIssues(
	conditions: Record<string, unknown>[],
	prefix = "",
): [DiagnosticSeverity, string][] {
	return conditions.flatMap((c, i) => {
		const label = `${prefix}${i + 1}`;
		if (!Array.isArray(c.group)) return conditionIssues(c, label);
		return c.group.length
			? dbConditionIssues(c.group, `${label}.`)
			: [["warning", `Group ${label} is empty. Add conditions to it or remove it.`]];
	});
}

function conditionIssues(
	c: Record<string, unknown>,
	label: string,
): [DiagnosticSeverity, string][] {
	if (c.operator === "raw") {
		return isBlank(c.raw)
			? [["warning", `Condition ${label} has an empty side. Fill both sides or remove it.`]]
			: [];
	}
	const lhs = c.attribute ?? c.lhs;
	const rhs = c.value ?? c.rhs;
	const issues: [DiagnosticSeverity, string][] = [];
	// the null/exists checks have no value to fill
	const valueless = VALUELESS.has(String(c.operator));
	if (isBlank(lhs) || (!valueless && isBlank(rhs))) {
		issues.push(["warning", `Condition ${label} has an empty side. Fill both sides or remove it.`]);
	}
	// the block schema rejects this; untagged sides are column (lhs) / value (rhs)
	if (kindOf(lhs) === "literal" && (valueless || kindOf(rhs) !== "column")) {
		issues.push(["error", `Condition ${label} compares two values. Switch one side to a column.`]);
	}
	return issues;
}
