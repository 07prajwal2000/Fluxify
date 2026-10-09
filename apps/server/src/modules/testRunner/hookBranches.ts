/**
 * The branch names a hook script skips down, where they are written as plain
 * text: `t.skip(output, "failure")` (#716). The save refuses a name the block does
 * not have instead of leaving it to fail on the first run.
 *
 * ponytail: a name that is a variable or an expression is not seen and still
 * fails when it runs; quotes inside comments can hide a later call. A real JS
 * parser would catch both.
 */
export function skipBranchLiterals(script: string): string[] {
	const names: string[] = [];
	for (const call of script.matchAll(/\bt\.skip\s*\(/g)) {
		const args: string[] = [];
		let depth = 1;
		let quote = "";
		let argStart = call.index + call[0].length;
		for (let i = argStart; i < script.length && depth > 0; i++) {
			const c = script[i]!;
			if (quote) {
				if (c === "\\") i++;
				else if (c === quote) quote = "";
			} else if (c === '"' || c === "'" || c === "`") quote = c;
			else if ("([{".includes(c)) depth++;
			else if (")]}".includes(c)) {
				if (--depth === 0) args.push(script.slice(argStart, i));
			} else if (c === "," && depth === 1) {
				args.push(script.slice(argStart, i));
				argStart = i + 1;
			}
		}
		const literal = /^\s*(["'])([^"'\\]*)\1\s*$/.exec(args[1] ?? "");
		if (literal) names.push(literal[2]!);
	}
	return names;
}
