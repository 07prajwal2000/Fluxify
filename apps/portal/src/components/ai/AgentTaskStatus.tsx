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
					const taskNodeId = `${task.assignedAgentNode}:${task.id}`;
					const stepUIState = run?.steps[taskNodeId];
					const rawLogs = stepUIState?.logs || [];
					
					const logs: typeof rawLogs = [];
					for (const log of rawLogs) {
						if (log.executionType === "tool" && log.toolName) {
							const existingIdx = logs.findIndex(g => g.executionType === "tool" && g.toolName === log.toolName);
							if (existingIdx >= 0) {
								logs[existingIdx] = log;
							} else {
								logs.push(log);
							}
						} else {
							logs.push(log);
						}
					}

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
								className={`transition-all duration-300 ease-in-out ${
									isExpanded ? "max-h-[140px] opacity-100 mt-1 mb-2 overflow-y-auto custom-scrollbar" : "max-h-0 opacity-0 overflow-hidden"
								}`}
							>
								<div className="flex flex-col gap-1.5 pl-3 pr-2 border-l border-border/50 ml-3.5 relative py-1">
									{logs.map((log, idx) => {
										let icon = <span className="w-[5px] h-[5px] rounded-full bg-border" />;
										const label = log.label;

										if (log.executionType === "tool") {
											icon = <TbTool size={11} className="text-muted" />;
										}

										return (
											<div key={`${log.timestamp}-${idx}`} className="flex items-start gap-2 w-full min-w-0">
												<div className="w-4 flex justify-center shrink-0 mt-[5px]">
													{icon}
												</div>
												<span className="text-[12px] text-muted leading-tight flex-1 min-w-0 break-words whitespace-pre-wrap">
													{label}
												</span>
											</div>
										);
									})}
									{logs.length === 0 && (
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
