import { useState, useEffect } from "react";
import { useConversationRun } from "@/store/aiHarness";
import { TbCheck, TbLoader, TbX, TbClock, TbChevronRight, TbChevronDown, TbTool } from "react-icons/tb";

function getHumanFriendlyName(name: string) {
	return name
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (str) => str.toUpperCase())
		.trim();
}

export function AgentTaskStatus({ conversationId }: { conversationId: string }) {
	const run = useConversationRun(conversationId);
	const tasksByLevel = run?.tasksByLevel;
	const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

	// Expand tasks that are currently running
	useEffect(() => {
		if (tasksByLevel) {
			const runningTasks = tasksByLevel.flat().filter(t => t.status === "running").map(t => t.id);
			if (runningTasks.length > 0) {
				setExpandedTasks(prev => {
					const next = new Set(prev);
					runningTasks.forEach(id => next.add(id));
					return next;
				});
			}
		}
	}, [tasksByLevel]);

	if (!tasksByLevel || tasksByLevel.length === 0) return null;

	const allTasks = tasksByLevel.flat();
	const isTerminal = run?.isTerminal;

	const toggleTask = (taskId: string) => {
		setExpandedTasks(prev => {
			const next = new Set(prev);
			if (next.has(taskId)) next.delete(taskId);
			else next.add(taskId);
			return next;
		});
	};

	return (
		<div
			className={`flex w-full flex-col gap-2 transition-all duration-700 ease-in-out overflow-hidden ${
				isTerminal ? "max-h-0 opacity-0 my-0 py-0" : "max-h-[2000px] opacity-100 py-2"
			}`}
		>
			<div className="text-[11px] font-semibold uppercase tracking-wider text-muted px-2 mb-1">
				Builder Execution Plan
			</div>
			<div className="flex flex-col gap-1 px-1">
				{allTasks.map((task) => {
					const isCompleted = task.status === "completed";
					const isRunning = task.status === "running";
					const isFailed = task.status === "failed";
					const isExpanded = expandedTasks.has(task.id);
					
					const statusIcon = isCompleted ? (
						<TbCheck className="text-success shrink-0" size={14} />
					) : isRunning ? (
						<TbLoader className="text-accent animate-spin shrink-0" size={14} />
					) : isFailed ? (
						<TbX className="text-danger shrink-0" size={14} />
					) : (
						<TbClock className="text-muted shrink-0" size={14} />
					);

					const humanName = getHumanFriendlyName(task.assignedAgentNode);
					const steps = Object.values(run?.steps || {})
						.filter(step => {
							if (step.node === task.assignedAgentNode) return true;
							const isSubAgentTask = task.assignedAgentNode === "blockBuilder" || task.assignedAgentNode === "routeConfig";
							if (isSubAgentTask && step.level === "sub_agent") {
								return step.node !== "blockBuilder" && step.node !== "routeConfig";
							}
							return false;
						})
						.sort((a, b) => a.timestamp - b.timestamp);

					return (
						<div key={task.id} className="flex flex-col">
							<button
								onClick={() => toggleTask(task.id)}
								className="flex items-center gap-2 rounded-md hover:bg-surface/50 px-2 py-1.5 text-left transition-colors cursor-pointer group"
							>
								{statusIcon}
								<div className="flex items-center gap-2 flex-1 min-w-0">
									<span className="font-medium text-foreground text-[13px] truncate">
										{humanName}
									</span>
								</div>
								
								<div className="flex items-center gap-2 shrink-0">
									<span className="text-[11px] text-muted capitalize">
										{task.status}
									</span>
									<div className="w-4 flex justify-center">
										{isExpanded ? (
											<TbChevronDown className="text-muted" size={14} />
										) : (
											<TbChevronRight className="text-muted" size={14} />
										)}
									</div>
								</div>
							</button>

							{/* Events Accordion */}
							<div
								className={`overflow-hidden transition-all duration-300 ease-in-out ${
									isExpanded ? "max-h-[500px] opacity-100 mt-1 mb-2" : "max-h-0 opacity-0"
								}`}
							>
								<div className="flex flex-col gap-1.5 pl-7 pr-2 border-l border-border/50 ml-3.5 relative py-1">
									{steps.map((step, idx) => {
										let icon = <span className="w-[5px] h-[5px] rounded-full bg-border shrink-0 absolute -left-[3px] top-[7px]" />;
										const label = step.label;

										if (step.executionType === "tool") {
											icon = <TbTool size={11} className="text-muted absolute -left-[6px] top-[4px]" />;
										}

										return (
											<div key={step.nodeId || idx} className="flex items-start gap-2 relative">
												{icon}
												<span className="text-[12px] text-muted leading-tight">
													{label}
												</span>
											</div>
										);
									})}
									{steps.length === 0 && (
										<div className="text-[12px] text-muted/50 italic">No events recorded yet.</div>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
