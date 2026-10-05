const IDENTIFIER = /[A-Za-z0-9_$]/;

/** where the quoted string, quoted name or comment starting at `i` ends, or -1 if none starts there */
function skipEnd(sql: string, i: number): number {
	const c = sql[i];
	if (c === "'" || c === '"' || c === "`") {
		let j = i + 1;
		while (j < sql.length && sql[j] !== c) j += sql[j] === "\\" && c !== "`" ? 2 : 1;
		return j + 1;
	}
	const lineComment =
		c === "#" || (c === "-" && sql[i + 1] === "-" && /\s/.test(sql[i + 2] ?? " "));
	if (lineComment) {
		const end = sql.indexOf("\n", i);
		return end === -1 ? sql.length : end;
	}
	if (c === "/" && sql[i + 1] === "*") {
		const end = sql.indexOf("*/", i + 2);
		return end === -1 ? sql.length : end + 2;
	}
	return -1;
}

/**
 * Lets native SQL written Postgres-style (`$1, $2`) run on MySQL, whose driver
 * only knows `?` (#514): each `$n` becomes `?` and params are reordered to match,
 * so a repeated `$1` sends its value twice. `$` inside strings, quoted names and
 * comments is left alone (`'$.a'` JSON paths), and a query with no `$n` passes
 * through untouched, so plain `?` keeps working.
 */
export function mysqlPlaceholders(sql: string, params: unknown[] = []) {
	let out = "";
	const ordered: unknown[] = [];
	let found = false;
	let question = false;
	let i = 0;
	while (i < sql.length) {
		const end = skipEnd(sql, i);
		if (end !== -1) {
			out += sql.slice(i, end);
			i = end;
			continue;
		}
		const number =
			sql[i] === "$" && !IDENTIFIER.test(sql[i - 1] ?? "") && sql.slice(i + 1).match(/^\d+/)?.[0];
		if (number) {
			const n = Number(number);
			if (n < 1 || n > params.length)
				throw new Error(`$${number} has no value: params has ${params.length}`);
			ordered.push(params[n - 1]);
			out += "?";
			found = true;
			i += number.length + 1;
			continue;
		}
		if (sql[i] === "?") question = true;
		out += sql[i++];
	}
	if (!found) return { sql, params };
	if (question) throw new Error("use either $1 placeholders or ?, not both");
	return { sql: out, params: ordered };
}
