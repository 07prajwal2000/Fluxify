/** One before/after row in an artifact panel. Shared by the route and custom
 *  block panels — both show "this is what the agent wants to change". */
export function Field({
	label,
	current,
	next,
}: {
	label: string;
	current?: unknown;
	next?: unknown;
}) {
	const text = (v: unknown) =>
		v === undefined || v === null || v === ""
			? ""
			: typeof v === "string"
				? v
				: JSON.stringify(v, null, 2);
	const before = text(current);
	const after = text(next);
	// nothing proposed for this field → it stays as-is, show one box
	const changed = after !== "" && after !== before;

	return (
		<div>
			<span className="text-[10px] text-muted uppercase font-bold tracking-wider">
				{label}
			</span>
			{changed && before !== "" && (
				<pre className="text-xs whitespace-pre-wrap break-all mt-1 p-2 rounded-md bg-danger/10 border border-danger/30 text-muted line-through">
					{before}
				</pre>
			)}
			<pre
				className={`text-xs whitespace-pre-wrap break-all mt-1 p-2 rounded-md border ${
					changed
						? "bg-success/10 border-success/30 text-foreground"
						: "bg-surface-secondary border-border text-muted"
				}`}
			>
				{(changed ? after : before) || "—"}
			</pre>
		</div>
	);
}
