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

/**
 * what is wrong with a db sort list: a blank column is an error (the database
 * rejects it), a column sorted twice a warning (the second entry changes nothing)
 */
export function dbSortIssues(raw: unknown): [DiagnosticSeverity, string][] {
	const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? [raw] : [];
	const seen = new Set<string>();
	return list.flatMap((entry, i): [DiagnosticSeverity, string][] => {
		const column = (entry as { attribute?: unknown } | null)?.attribute;
		if (isBlank(column)) return [["error", `Sort ${i + 1} has no column. Pick one or remove it.`]];
		const key = String(column).trim();
		if (seen.has(key)) {
			return [["warning", `Sort ${i + 1} repeats ${key}, so it changes nothing. Remove it.`]];
		}
		seen.add(key);
		return [];
	});
}

/** joins missing their table or column */
export function dbJoinIssues(joins: unknown[]): [DiagnosticSeverity, string][] {
	return (joins as Record<string, unknown>[]).flatMap((j, i): [DiagnosticSeverity, string][] =>
		isBlank(j.table) || isBlank(j.attribute)
			? [
					[
						"warning",
						`Join ${i + 1} is missing its table or column. Fill it in the Joins tab or remove it.`,
					],
				]
			: [],
	);
}
