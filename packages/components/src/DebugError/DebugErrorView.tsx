/** The real error of a failed run: which block, why, and where in the user's code. */
export type DebugErrorInfo = {
	block?: { id: string; type: string; name?: string };
	message: string;
	detail?: string;
	stack?: string;
};

export function DebugErrorView({
	error,
	onSelectBlock,
}: {
	error: DebugErrorInfo;
	/** given, the block name is a button (the canvas can show it); else plain text */
	onSelectBlock?: (blockId: string, message: string) => void;
}) {
	const { block } = error;
	const label = block ? block.name || block.type : undefined;
	return (
		<div className="space-y-1.5 rounded-md border border-danger/40 bg-danger/10 p-3 text-xs">
			{block && label && (
				<div className="text-muted">
					Failed in block{" "}
					{onSelectBlock ? (
						<button
							type="button"
							className="font-semibold text-accent underline"
							onClick={() => onSelectBlock(block.id, error.message)}
						>
							{label}
						</button>
					) : (
						<span className="font-semibold text-foreground">{label}</span>
					)}
				</div>
			)}
			<p className="break-words font-medium text-danger">{error.message}</p>
			{error.detail && (
				<pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-foreground">
					{error.detail}
				</pre>
			)}
			{error.stack && (
				<pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
					{error.stack}
				</pre>
			)}
		</div>
	);
}
