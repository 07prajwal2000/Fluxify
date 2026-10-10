import { type DiffLine, diffLines, withContext } from "./lineDiff";

const TONE = {
	add: "bg-success/15 text-foreground",
	del: "bg-danger/15 text-foreground line-through decoration-danger/40",
	same: "text-muted",
} as const;
const SIGN = { add: "+", del: "-", same: " " } as const;

/** Two texts as a line diff: changed lines coloured, long unchanged runs folded. */
export function TextDiff({ before, after }: { before: string; after: string }) {
	const rows = withContext(diffLines(before, after));
	return (
		<pre className="max-h-64 overflow-auto rounded-md border border-border bg-background-secondary py-1 font-mono text-xs">
			{rows.map((line: DiffLine | null, i) =>
				line === null ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows never reorder
					<div key={i} className="px-2 text-muted/60">
						⋯
					</div>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows never reorder
					<div key={i} className={`whitespace-pre-wrap px-2 ${TONE[line.kind]}`}>
						<span className="select-none pr-2 text-muted">{SIGN[line.kind]}</span>
						{line.text}
					</div>
				),
			)}
		</pre>
	);
}
