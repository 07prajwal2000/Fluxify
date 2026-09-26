import { Button, Chip } from "@heroui/react";
import { TbChevronRight, TbMinus } from "react-icons/tb";
import type { Condition } from "./types";
import { countIncomplete, formatConditionsSummary } from "./utils";

/** Marks a row that joins the ones before it with OR. */
export function OrDivider() {
	return (
		<div className="flex items-center gap-3 my-1">
			<div className="h-px flex-1 bg-border" />
			<span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
				OR
			</span>
			<div className="h-px flex-1 bg-border" />
		</div>
	);
}

/**
 * A group, one level up from its conditions: a one-line summary so the whole
 * query reads from the top, a count of what is still unfilled inside, and the
 * way in. Its conditions are edited on their own level, never indented here.
 */
export function ConditionsGroupRow({
	condition,
	index,
	isDisabled,
	onOpen,
	onRemove,
}: {
	condition: Condition & { group: Condition[] };
	index: number;
	isDisabled?: boolean;
	onOpen: (index: number) => void;
	onRemove: (index: number) => void;
}) {
	const incomplete = countIncomplete(condition.group);
	return (
		<div className="flex flex-col gap-2 w-full">
			{condition.chain === "or" && <OrDivider />}
			<div className="flex flex-row items-center gap-2 w-full rounded-[var(--radius)] border border-border px-3 py-2">
				<span className="flex-1 min-w-0 truncate font-mono text-xs text-muted-foreground">
					{condition.group.length
						? `( ${formatConditionsSummary(condition.group)} )`
						: "( empty group )"}
				</span>
				{incomplete > 0 && (
					<Chip color="warning" size="sm" variant="soft">
						{incomplete} to fill
					</Chip>
				)}
				<Button
					aria-label={`Open group ${index + 1}`}
					size="sm"
					variant="secondary"
					onPress={() => onOpen(index)}
				>
					Open
					<TbChevronRight className="size-4" />
				</Button>
				{!isDisabled && (
					<Button
						aria-label="Remove group"
						isIconOnly
						size="sm"
						variant="ghost"
						onPress={() => onRemove(index)}
					>
						<TbMinus className="text-danger size-4" />
					</Button>
				)}
			</div>
		</div>
	);
}
