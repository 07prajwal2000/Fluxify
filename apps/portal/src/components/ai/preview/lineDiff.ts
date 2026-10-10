export type DiffLine = { kind: "same" | "add" | "del"; text: string };

/** Past this many line pairs the diff is not worth the wait: show the old text gone and the new one in. */
const MAX_CELLS = 250_000;

/** A line diff by longest common subsequence. */
export function diffLines(before: string, after: string): DiffLine[] {
	const a = before.split("\n");
	const b = after.split("\n");
	if (a.length * b.length > MAX_CELLS)
		return [
			...a.map((text) => ({ kind: "del" as const, text })),
			...b.map((text) => ({ kind: "add" as const, text })),
		];
	// lcs[i][j]: length of the common run of a[i..] and b[j..]
	const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
	const out: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j]) {
			out.push({ kind: "same", text: a[i] });
			i++;
			j++;
		} else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: a[i++] });
		else out.push({ kind: "add", text: b[j++] });
	}
	while (i < a.length) out.push({ kind: "del", text: a[i++] });
	while (j < b.length) out.push({ kind: "add", text: b[j++] });
	return out;
}

/** Unchanged runs longer than `2 * context` shrink to their ends; the cut is a `null`. */
export function withContext(lines: DiffLine[], context = 2): (DiffLine | null)[] {
	const keep = lines.map((_, i) =>
		lines.slice(Math.max(0, i - context), i + context + 1).some((n) => n.kind !== "same"),
	);
	const out: (DiffLine | null)[] = [];
	lines.forEach((l, i) => {
		if (keep[i]) out.push(l);
		else if (out.at(-1) !== null) out.push(null);
	});
	return out;
}
