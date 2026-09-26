import { Accordion, Breadcrumbs, Button } from "@heroui/react";
import clsx from "clsx";
import { useCallback, useMemo, useState } from "react";
import { TbChevronDown } from "react-icons/tb";
import { ConditionsBuilderRow } from "./ConditionsBuilderRow";
import { ConditionsGroupRow } from "./ConditionsGroupRow";
import type {
	Condition,
	ConditionChain,
	ConditionOperator,
	ConditionsBuilderProps,
	ConditionValue,
} from "./types";
import {
	conditionsAt,
	formatConditionsSummary,
	isGroup,
	validPath,
	withConditionsAt,
} from "./utils";

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
	lhsSuggestions,
	rhsSuggestions,
	allowColumnRefs = false,
	customConditionEditor,
	allowGroups = false,
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

	// the open group, as indices from the top list down; [] is the top itself.
	// Nesting is navigation rather than indentation, so any depth stays readable.
	const [openPath, setOpenPath] = useState<number[]>([]);
	const path = useMemo(() => validPath(conditions, openPath), [conditions, openPath]);
	const level = useMemo(() => conditionsAt(conditions, path), [conditions, path]);
	const updateLevel = useCallback(
		(nextLevel: Condition[]) => updateConditions(withConditionsAt(conditions, path, nextLevel)),
		[conditions, path, updateConditions],
	);

	const handleAddCondition = useCallback(
		(chain: ConditionChain = "and") => {
			const next: Condition[] = [
				...level,
				{ lhs: "", rhs: "", operator: "eq" as ConditionOperator, chain },
			];
			updateLevel(next);
		},
		[level, updateLevel],
	);

	const handleAddGroup = useCallback(
		(chain: ConditionChain = "and") => {
			updateLevel([...level, { lhs: "", rhs: "", operator: "eq", chain, group: [] }]);
			// an empty group does nothing, so go straight in to fill it
			setOpenPath([...path, level.length]);
		},
		[level, path, updateLevel],
	);

	const handleRemoveCondition = useCallback(
		(index: number) => {
			const next = [...level];
			next.splice(index, 1);
			updateLevel(next);
		},
		[level, updateLevel],
	);

	const handleLHSChange = useCallback(
		(index: number, value: ConditionValue) => {
			const next = [...level];
			next[index] = { ...next[index], lhs: value };
			updateLevel(next);
		},
		[level, updateLevel],
	);

	const handleRHSChange = useCallback(
		(index: number, value: ConditionValue) => {
			const next = [...level];
			next[index] = { ...next[index], rhs: value };
			updateLevel(next);
		},
		[level, updateLevel],
	);

	const handleOperatorChange = useCallback(
		(index: number, operator: ConditionOperator) => {
			const next = [...level];
			next[index] = { ...next[index], operator };
			// a JS filter starts in expression mode, so an untouched one compiles to
			// `undefined` and is skipped instead of being read as empty SQL
			if (operator === "raw" && next[index].raw === undefined) {
				next[index].raw = customConditionEditor === "js" ? "js:" : "";
			}
			updateLevel(next);
		},
		[level, updateLevel, customConditionEditor],
	);

	const handleRawChange = useCallback(
		(index: number, raw: string) => {
			const next = [...level];
			next[index] = { ...next[index], raw };
			updateLevel(next);
		},
		[level, updateLevel],
	);

	const handleJsChange = useCallback(
		(index: number, value: string) => {
			const next = [...level];
			next[index] = { ...next[index], js: value };
			updateLevel(next);
		},
		[level, updateLevel],
	);

	const summaryText = useMemo(() => formatConditionsSummary(conditions), [conditions]);

	const expandedKeys = useMemo(() => new Set(isExpanded ? ["conditions"] : []), [isExpanded]);

	const content = (
		<div className="flex flex-col gap-3 w-full pt-2">
			{path.length > 0 && (
				<Breadcrumbs>
					{[[], ...path.map((_, depth) => path.slice(0, depth + 1))].map((crumb) => (
						<Breadcrumbs.Item key={crumb.join(".")} onPress={() => setOpenPath(crumb)}>
							{crumb.length ? `Group ${crumb[crumb.length - 1] + 1}` : label || "Conditions"}
						</Breadcrumbs.Item>
					))}
				</Breadcrumbs>
			)}
			{level.map((condition, index) =>
				isGroup(condition) ? (
					<ConditionsGroupRow
						key={index}
						condition={condition}
						index={index}
						isDisabled={isDisabled}
						onOpen={(i) => setOpenPath([...path, i])}
						onRemove={handleRemoveCondition}
					/>
				) : (
					<ConditionsBuilderRow
						key={index}
						condition={condition}
						disableJsConditions={disableJsConditions}
						ignoreOperators={ignoreOperators}
						index={index}
						isDisabled={isDisabled}
						allowColumnRefs={allowColumnRefs}
						customConditionEditor={customConditionEditor}
						onRawChange={handleRawChange}
						lhsSuggestions={lhsSuggestions}
						rhsSuggestions={rhsSuggestions}
						onJsChange={handleJsChange}
						onLHSChange={handleLHSChange}
						onOperatorChange={handleOperatorChange}
						onRHSChange={handleRHSChange}
						onRemoveCondition={handleRemoveCondition}
					/>
				),
			)}

			{!isDisabled && (
				<div className="flex items-center gap-2 w-full pt-1">
					<Button
						className="flex-1"
						isDisabled={isDisabled}
						variant="outline"
						onPress={() => handleAddCondition("and")}
					>
						Add {level.length > 0 ? "And " : ""}Condition
					</Button>
					{level.length > 0 && (
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
			{!isDisabled && allowGroups && (
				<div className="flex items-center gap-2 w-full">
					<Button className="flex-1" variant="ghost" onPress={() => handleAddGroup("and")}>
						Add {level.length > 0 ? "And " : ""}Group
					</Button>
					{level.length > 0 && (
						<Button className="flex-1" variant="ghost" onPress={() => handleAddGroup("or")}>
							Add Or Group
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
					<Accordion.Body className="border-t border-border/50 mt-2">{content}</Accordion.Body>
				</Accordion.Panel>
			</Accordion.Item>
		</Accordion>
	);
}
