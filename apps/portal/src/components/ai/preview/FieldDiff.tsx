import type { FieldChange } from "./canvasDiff";
import { fmt, isSecretKey, MASK, mask, oneLine } from "./data";
import { TextDiff } from "./TextDiff";

/** Code, scripts and anything long reads better as a text diff than as one line. */
const isLong = (v: unknown) =>
	typeof v === "string" && (v.includes("\n") || v.length > 60 || v.startsWith("js:"));

/** A value as text, secrets inside it hidden. */
const show = (field: string, v: unknown) => fmt(mask(v, field));

function Value({ field, change, hidden }: { field: string; change: FieldChange; hidden: boolean }) {
	const { before, after } = change;
	const hasBefore = "before" in change;
	const hasAfter = "after" in change;
	if (hidden) {
		return <span className="font-mono text-muted">{hasAfter ? MASK : "removed"}</span>;
	}
	if (hasBefore && hasAfter && (isLong(before) || isLong(after)))
		return <TextDiff before={show(field, before)} after={show(field, after)} />;
	if (hasAfter && isLong(after) && !hasBefore)
		return <TextDiff before="" after={show(field, after)} />;
	if (hasBefore && isLong(before) && !hasAfter)
		return <TextDiff before={show(field, before)} after="" />;
	return (
		<span className="flex min-w-0 flex-wrap items-baseline gap-1.5 font-mono">
			{hasBefore && (
				<del className="break-all rounded bg-danger/15 px-1 text-foreground decoration-danger/50">
					{oneLine(show(field, before), 200)}
				</del>
			)}
			{hasBefore && hasAfter && <span className="text-muted">→</span>}
			{hasAfter && (
				<ins className="break-all rounded bg-success/15 px-1 text-foreground no-underline">
					{oneLine(show(field, after), 200)}
				</ins>
			)}
		</span>
	);
}

/** Field-level before/after of one block or resource; a field with one side is added or removed. `secrets`: fields to hide besides the ones named like a secret. */
export function FieldDiff({ changes, secrets }: { changes: FieldChange[]; secrets?: Set<string> }) {
	if (!changes.length) return <p className="text-xs text-muted">No field changes.</p>;
	return (
		<dl className="flex flex-col gap-2 text-xs">
			{changes.map((c) => (
				<div key={c.field} className="flex flex-col gap-1">
					<dt className="font-medium text-foreground">{c.field}</dt>
					<dd className="min-w-0">
						<Value
							field={c.field}
							change={c}
							hidden={isSecretKey(c.field) || secrets?.has(c.field) === true}
						/>
					</dd>
				</div>
			))}
		</dl>
	);
}
