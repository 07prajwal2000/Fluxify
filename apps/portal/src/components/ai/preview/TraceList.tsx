import { TbCheck, TbX } from "react-icons/tb";
import { parseTrace } from "./trace";

/** The blocks a call ran, one row each, by key: ok or failed, how long, what they returned. */
export function TraceList({ lines }: { lines: string[] }) {
	return (
		<ol className="flex flex-col divide-y divide-border rounded-md border border-border text-xs">
			{lines.map((line, i) => {
				const row = parseTrace(line);
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: the same block can run twice
					<li key={i} className="flex items-start gap-2 px-2 py-1">
						{row.kind === "more" ? (
							<span className="text-muted">{row.text}</span>
						) : (
							<>
								{row.ok ? (
									<TbCheck size={13} aria-label="ok" className="mt-0.5 shrink-0 text-success" />
								) : (
									<TbX size={13} aria-label="failed" className="mt-0.5 shrink-0 text-danger" />
								)}
								<span className="shrink-0 font-mono font-medium text-foreground">{row.key}</span>
								<span className="shrink-0 text-muted">{row.type}</span>
								<span className="shrink-0 text-muted">{row.ms}ms</span>
								{row.detail && (
									<span
										className={`min-w-0 truncate font-mono ${row.ok ? "text-muted" : "text-danger"}`}
									>
										{row.detail}
									</span>
								)}
							</>
						)}
					</li>
				);
			})}
		</ol>
	);
}
