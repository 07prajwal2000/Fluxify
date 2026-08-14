import { useState } from "react";
import { useConversationRun } from "@/store/aiHarness";
import { TbCheck, TbLoader, TbClock, TbChevronRight, TbChevronDown } from "react-icons/tb";

export function HarnessStatusAccordion({ conversationId }: { conversationId: string }) {
	const run = useConversationRun(conversationId);
	const [isExpanded, setIsExpanded] = useState(true);

	if (!run || run.isTerminal) return null;

	const harnessSteps = Object.values(run.steps)
		.filter(step => step.level === "harness" && step.node !== "run" && step.node !== "humanInTheLoop")
		.sort((a, b) => a.timestamp - b.timestamp);

	if (harnessSteps.length === 0) {
		return (
			<div className="flex w-full flex-col gap-2 mb-2">
				<div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted px-2">
					<TbLoader className="text-muted animate-spin" size={14} />
					{run.runStatus.replace(/_/g, " ")}
				</div>
			</div>
		);
	}

	return (
		<div className="flex w-full flex-col gap-2 mb-2">
			<button 
				onClick={() => setIsExpanded(!isExpanded)}
				className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted px-2 cursor-pointer hover:text-foreground transition-colors group self-start text-left max-w-full"
			>
				<span className="break-words flex-1 min-w-0">{run.runStatus.replace(/_/g, " ")}</span>
				<div className="text-muted group-hover:text-foreground transition-colors shrink-0">
					{isExpanded ? <TbChevronDown size={14} /> : <TbChevronRight size={14} />}
				</div>
			</button>
			<div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? "max-h-[500px] opacity-100 mt-1" : "max-h-0 opacity-0"}`}>
				<div className="flex flex-col gap-3 p-4 bg-surface-secondary rounded-xl border border-border mx-2">
					{harnessSteps.map(step => {
						const isCompleted = step.nodeStatus === "ended";
						const isRunning = step.nodeStatus === "started" || step.nodeStatus === "running";
						const icon = isCompleted ? (
							<TbCheck className="text-success" size={14} />
						) : isRunning ? (
							<TbLoader className="text-accent animate-spin" size={14} />
						) : (
							<TbClock className="text-muted" size={14} />
						);
						
						return (
							<div key={step.nodeId} className="flex items-start gap-3">
								<div className="w-4 flex justify-center shrink-0 mt-[2px]">
									{icon}
								</div>
								<div className="flex flex-col flex-1 min-w-0">
									<span className="text-[13px] font-medium text-foreground capitalize">
										{step.node.replace(/([A-Z])/g, " $1").trim()}
									</span>
									<span className="text-[12px] text-muted leading-tight mt-0.5 break-words whitespace-pre-wrap">
										{step.label}
									</span>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
