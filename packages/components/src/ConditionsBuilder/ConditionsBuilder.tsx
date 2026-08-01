import { Accordion, Button } from "@heroui/react";
import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";
import { TbChevronDown } from "react-icons/tb";
import { ConditionsBuilderRow } from "./ConditionsBuilderRow";
import type { Condition, ConditionChain, ConditionOperator, ConditionsBuilderProps } from "./types";
import { formatConditionsSummary } from "./utils";

export function ConditionsBuilder({
	label,
	description,
	collapsible = true,
	defaultExpanded = false,
	isExpanded: controlledExpanded,
	onExpandedChange,
	conditions = [],
	onChange,
	disableJsConditions = false,
	ignoreOperators = [],
	isDisabled = false,
	hasBorder = false,
	className,
}: ConditionsBuilderProps) {
	const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);
	const isExpanded = controlledExpanded ?? (collapsible ? internalExpanded : true);

	const handleExpandedChange = useCallback(
		(nextIsExpanded: boolean) => {
			if (!collapsible) return;
			if (controlledExpanded === undefined) {
				setInternalExpanded(nextIsExpanded);
			}
			onExpandedChange?.(nextIsExpanded);
		},
		[collapsible, controlledExpanded, onExpandedChange],
	);

	const updateConditions = useCallback(
		(nextConditions: Condition[]) => {
			onChange?.(nextConditions);
		},
		[onChange],
	);

	const handleAddCondition = useCallback(
		(chain: ConditionChain = "and") => {
			const next: Condition[] = [
				...conditions,
				{ lhs: "", rhs: "", operator: "eq" as ConditionOperator, chain },
			];
			updateConditions(next);
		},
		[conditions, updateConditions],
	);

	const handleRemoveCondition = useCallback(
		(index: number) => {
			const next = [...conditions];
			next.splice(index, 1);
			updateConditions(next);
		},
		[conditions, updateConditions],
	);

	const handleLHSChange = useCallback(
		(index: number, value: string) => {
			const next = [...conditions];
			next[index] = { ...next[index], lhs: value };
			updateConditions(next);
		},
		[conditions, updateConditions],
	);

	const handleRHSChange = useCallback(
		(index: number, value: string) => {
			const next = [...conditions];
			next[index] = { ...next[index], rhs: value };
			updateConditions(next);
		},
		[conditions, updateConditions],
	);

	const handleOperatorChange = useCallback(
		(index: number, operator: ConditionOperator) => {
			const next = [...conditions];
			next[index] = { ...next[index], operator };
			updateConditions(next);
		},
		[conditions, updateConditions],
	);

	const handleJsChange = useCallback(
		(index: number, value: string) => {
			const next = [...conditions];
			next[index] = { ...next[index], js: value };
			updateConditions(next);
		},
		[conditions, updateConditions],
	);

	const summaryText = useMemo(() => formatConditionsSummary(conditions), [conditions]);

	const expandedKeys = useMemo(
		() => new Set(isExpanded ? ["conditions"] : []),
		[isExpanded],
	);

	const content = (
		<div className="flex flex-col gap-3 w-full pt-2">
			{conditions.map((condition, index) => (
				<ConditionsBuilderRow
					key={index}
					condition={condition}
					disableJsConditions={disableJsConditions}
					ignoreOperators={ignoreOperators}
					index={index}
					isDisabled={isDisabled}
					onJsChange={handleJsChange}
					onLHSChange={handleLHSChange}
					onOperatorChange={handleOperatorChange}
					onRHSChange={handleRHSChange}
					onRemoveCondition={handleRemoveCondition}
				/>
			))}

			{!isDisabled && (
				<div className="flex items-center gap-2 w-full pt-1">
					<Button
						className="flex-1"
						isDisabled={isDisabled}
						variant="outline"
						onPress={() => handleAddCondition("and")}
					>
						Add {conditions.length > 0 ? "And " : ""}Condition
					</Button>
					{conditions.length > 0 && (
						<Button
							className="flex-1"
							isDisabled={isDisabled}
							variant="outline"
							onPress={() => handleAddCondition("or")}
						>
							Add Or Condition
						</Button>
					)}
				</div>
			)}
		</div>
	);

	if (!collapsible) {
		return (
			<div
				className={clsx(
					"flex flex-col w-full rounded-[var(--radius)] bg-surface",
					hasBorder ? "border border-border p-3" : "p-0",
					className,
				)}
			>
				<div className="flex items-center gap-2.5 min-w-0 flex-1 mb-1">
					<span className="text-sm font-semibold text-foreground truncate">
						{label || "Conditions"}
					</span>
					<span className="text-xs font-mono text-muted-foreground bg-surface-secondary px-2 py-0.5 rounded-full border border-border shrink-0">
						{conditions.length} {conditions.length === 1 ? "condition" : "conditions"}
					</span>
				</div>
				{description && (
					<p className="text-xs text-muted-foreground leading-normal mb-3">{description}</p>
				)}
				{content}
			</div>
		);
	}

	return (
		<Accordion
			hideSeparator
			className={clsx(
				"w-full rounded-[var(--radius)] bg-surface",
				hasBorder ? "border border-border p-2" : "p-0",
				className,
			)}
			expandedKeys={expandedKeys}
			isDisabled={isDisabled}
			onExpandedChange={(keys) => handleExpandedChange(keys.has("conditions"))}
		>
			<Accordion.Item id="conditions">
				<Accordion.Trigger className="w-full flex items-center justify-between gap-2 py-1">
					<div className="flex flex-col items-start gap-1 w-full text-left">
						<div className="flex items-center gap-2.5 min-w-0 w-full">
							<span className="text-sm font-semibold text-foreground truncate">
								{label || "Conditions"}
							</span>
							<span className="text-xs font-mono text-muted-foreground bg-surface-secondary px-2 py-0.5 rounded-full border border-border shrink-0">
								{conditions.length} {conditions.length === 1 ? "condition" : "conditions"}
							</span>
						</div>
						{description && (
							<p className="text-xs text-muted-foreground leading-normal">{description}</p>
						)}
					</div>
					<span
						className={clsx(
							"inline-flex shrink-0 items-center justify-center text-muted-foreground transition-transform duration-300 ease-in-out ml-2",
							isExpanded ? "rotate-180" : "rotate-0",
						)}
					>
						<TbChevronDown size={18} />
					</span>
				</Accordion.Trigger>
				
				{/* When closed, we show the summary right below the trigger by injecting it inside the accordion item layout, 
				    but the Accordion.Panel only renders when expanded. We can put the summary in the Panel or in a custom div. 
					Actually, Accordion.Item doesn't officially support custom nodes outside Trigger and Panel.
					Let's conditionally render the summary block here. */}
				{!isExpanded && (
					<div className="w-full mt-2">
						<div className="flex flex-col gap-1.5 rounded-[var(--radius)] bg-background p-2.5 border border-border">
							<div className="flex items-center">
								<span className="px-1.5 py-0.5 rounded bg-surface-secondary text-muted-foreground border border-border text-[10px] font-mono font-semibold uppercase leading-none select-none">
									PREVIEW
								</span>
							</div>
							<pre className="font-mono text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap m-0">
								{summaryText}
							</pre>
						</div>
					</div>
				)}

				<Accordion.Panel>
					<Accordion.Body className="border-t border-border/50 mt-2">
						{content}
					</Accordion.Body>
				</Accordion.Panel>
			</Accordion.Item>
		</Accordion>
	);
}
