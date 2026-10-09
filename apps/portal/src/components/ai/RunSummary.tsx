import { TbCheck, TbTrash } from "react-icons/tb";
import type { AgentRow, AgentRun } from "@/services/agentConversations";
import { AgentRef } from "./AgentRef";
import { type Change, fmtDuration, fmtTokens, runChanges } from "./runChanges";

const VERBS: Record<Change["action"], string> = {
	created: "Created",
	updated: "Updated",
	deleted: "Deleted",
};

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col">
			<span className="text-sm font-medium text-foreground">{value}</span>
			<span className="text-[11px] text-muted">{label}</span>
		</div>
	);
}

/** After a finished run: what it cost and what it changed, with links to the resources. */
export function RunSummary({ run, rows }: { run: AgentRun; rows: AgentRow[] }) {
	const u = run.usage;
	if (run.status !== "completed" || !u) return null;
	const changes = runChanges(rows, run.id);
	return (
		<section
			aria-label="Run summary"
			className="flex flex-col gap-3 rounded-xl border border-border bg-surface px-4 py-3"
		>
			<div className="flex flex-wrap gap-x-6 gap-y-2">
				<Stat label="Steps" value={String(u.steps)} />
				<Stat label="Input tokens" value={fmtTokens(u.inputTokens)} />
				<Stat label="Output tokens" value={fmtTokens(u.outputTokens)} />
				<Stat label="Cache read" value={fmtTokens(u.cacheReadTokens)} />
				<Stat label="Time" value={fmtDuration(u.durationMs)} />
			</div>
			{changes.length > 0 && (
				<ul className="flex flex-col gap-1 border-t border-border pt-2 text-xs">
					{changes.map((c) => (
						<li key={`${c.type}:${c.id}`} className="flex items-center gap-2">
							<span className="flex w-16 shrink-0 items-center gap-1 text-muted">
								{c.action === "deleted" ? (
									<TbTrash size={12} className="text-danger" />
								) : (
									<TbCheck size={12} className="text-success" />
								)}
								{VERBS[c.action]}
							</span>
							{c.action === "deleted" ? (
								<span className="text-muted line-through">{c.label}</span>
							) : (
								<AgentRef type={c.type} id={c.id}>
									{c.label}
								</AgentRef>
							)}
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
