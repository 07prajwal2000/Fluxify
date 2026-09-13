/**
 * Splits a custom SQL condition into the SQL around each `{{ }}` placeholder
 * and the JS expression inside it. The SQL pieces are kept verbatim; every
 * expression becomes a bound parameter, so a runtime value can never change
 * the shape of the query.
 *
 * Pure on purpose: both the compiler and the interpreted blocks import it, and
 * nothing here may pull the compiler into `schema.ts`'s import graph.
 */
// ponytail: `}}` ends a placeholder, so an expression that itself ends in `}}`
// (a nested object literal) has to be written with a space: `{{ ({ a: { b } }) }}`.
export function parseSqlTemplate(text: string) {
	if (!text.trim()) throw new Error("custom condition is empty");
	const strings: string[] = [];
	const expressions: string[] = [];
	let last = 0;
	for (const match of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
		const expression = match[1].trim();
		if (!expression) {
			throw new Error(`empty {{ }} placeholder in custom condition: ${text}`);
		}
		strings.push(text.slice(last, match.index));
		expressions.push(expression);
		last = match.index! + match[0].length;
	}
	strings.push(text.slice(last));
	return { strings, expressions };
}
