import { Button, CloseButton, Popover, PopoverContent, PopoverTrigger } from "@fluxify/components";
import { useState } from "react";
import { TbCircle, TbCircleCheck, TbCircleMinus, TbListCheck, TbProgress } from "react-icons/tb";
import {
	dismissedList,
	dismissList,
	isOpen,
	progressOf,
	STATUS_LABEL,
	type Todo,
	type TodoStatus,
} from "./todos";

const ICON: Record<TodoStatus, { Icon: typeof TbCircle; className: string }> = {
	pending: { Icon: TbCircle, className: "text-muted" },
	in_progress: { Icon: TbProgress, className: "text-warning" },
	done: { Icon: TbCircleCheck, className: "text-success" },
	dropped: { Icon: TbCircleMinus, className: "text-muted" },
};

function Item({ todo }: { todo: Todo }) {
	const { Icon, className } = ICON[todo.status];
	const busy = todo.status === "in_progress";
	return (
		<div
			data-status={todo.status}
			className={`flex items-start gap-2 rounded-md px-1.5 py-0.5 ${busy ? "bg-surface-secondary font-medium" : ""}`}
		>
			<Icon
				size={14}
				aria-label={STATUS_LABEL[todo.status]}
				className={`mt-0.5 shrink-0 ${className}`}
			/>
			<span className="shrink-0 font-mono text-muted">{todo.id}</span>
			<span
				className={`min-w-0 flex-1 break-words ${todo.status === "dropped" ? "text-muted line-through" : "text-foreground"}`}
			>
				{todo.text}
			</span>
		</div>
	);
}

/** The agent's todo list (#771): main tasks with their subtasks, each with its status. */
export function TodoItems({ todos }: { todos: Todo[] }) {
	return (
		<ul aria-label="Tasks" className="flex flex-col gap-0.5 text-xs">
			{todos.map((t) => (
				<li key={t.id}>
					<Item todo={t} />
					{!!t.subtasks?.length && (
						<ul className="ml-5 flex flex-col gap-0.5">
							{t.subtasks.map((s) => (
								<li key={s.id}>
									<Item todo={s} />
								</li>
							))}
						</ul>
					)}
				</li>
			))}
		</ul>
	);
}

/**
 * Next to the pickers while the agent keeps a list: main tasks done, and the list on click.
 * Hidden with no list. A finished list can be closed; it stays closed for this conversation
 * until the list changes.
 */
export function TodosButton({ todos, conversationId }: { todos: Todo[]; conversationId: string }) {
	const key = JSON.stringify(todos);
	// this page's answer, for when storage is unavailable
	const [closed, setClosed] = useState<string>();
	if (
		!todos.length ||
		closed === `${conversationId}:${key}` ||
		dismissedList(conversationId) === key
	)
		return null;
	const { done, total } = progressOf(todos);
	const close = () => {
		dismissList(conversationId, key);
		setClosed(`${conversationId}:${key}`);
	};
	return (
		<Popover>
			<PopoverTrigger>
				<Button
					size="sm"
					variant="ghost"
					aria-label={`Tasks: ${done} of ${total} done`}
					className="h-8 min-h-8 gap-1 text-xs"
				>
					<TbListCheck size={16} />
					{done}/{total}
				</Button>
			</PopoverTrigger>
			<PopoverContent className="flex max-h-[min(36rem,70vh)] w-[min(32rem,calc(100vw-2rem))] flex-col overflow-y-auto p-0">
				<header
					data-testid="tasks-header"
					className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-overlay px-3 py-2"
				>
					<p className="flex-1 text-xs font-medium text-muted">
						Tasks · {done} of {total} done
					</p>
					{!isOpen(todos) && <CloseButton aria-label="Close tasks" onPress={close} />}
				</header>
				<div className="p-3">
					<TodoItems todos={todos} />
				</div>
			</PopoverContent>
		</Popover>
	);
}
