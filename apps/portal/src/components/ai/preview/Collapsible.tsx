import type { ReactNode } from "react";
import { fmt } from "./data";

const SMALL_LINES = 12;
const SMALL_CHARS = 600;

/** A value as pretty text, folded when it is long so a big payload does not push the chat away. */
export function JsonBlock({ label, value }: { label: string; value: unknown }) {
	let shown = value;
	if (typeof value === "string") {
		try {
			shown = JSON.parse(value);
		} catch {
			// not JSON: shown as it is
		}
	}
	const text = fmt(shown);
	const lines = text.split("\n").length;
	const small = lines <= SMALL_LINES && text.length <= SMALL_CHARS;
	return (
		<Fold label={`${label}${small ? "" : ` (${lines} lines)`}`} open={small}>
			<pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background-secondary p-2 font-mono text-xs text-foreground/80">
				{text}
			</pre>
		</Fold>
	);
}

/** A native fold: its content stays out of the way until opened. */
export function Fold({
	label,
	open,
	children,
}: {
	label: string;
	open?: boolean;
	children: ReactNode;
}) {
	return (
		<details open={open} className="group text-xs">
			<summary className="cursor-pointer list-none font-medium text-muted hover:text-foreground">
				<span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
				{label}
			</summary>
			<div className="mt-1">{children}</div>
		</details>
	);
}
