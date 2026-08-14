import { Button, ListBox, Select, Tooltip } from "@heroui/react";
import { useCallback, useMemo } from "react";
import { TbAbc, TbMinus, TbTable } from "react-icons/tb";
import { isJsExpression, JsTextField, readExpression, writeExpression } from "../JsTextField";
import { ALL_OPERATORS } from "./constants";
import type { Condition, ConditionOperator, ConditionValue } from "./types";
import { conditionText, encodeSide, sideIsColumn, toggleSideMode } from "./utils";

/**
 * Switches one side between naming a column and holding a value. Which of the
 * two needs a tag depends on the side, so the caller passes the encoder.
 */
function ModeToggle({
	isColumnMode,
	isDisabled,
	onToggle,
}: {
	isColumnMode: boolean;
	isDisabled?: boolean;
	onToggle: () => void;
}) {
	return (
		<div className="shrink-0 flex items-center justify-center">
			<Tooltip>
				<Button
					aria-label={
						isColumnMode
							? "Comparing against a column — switch to a value"
							: "Comparing against a value — switch to a column"
					}
					isIconOnly
					isDisabled={isDisabled}
					size="sm"
					variant="ghost"
					onPress={onToggle}
				>
					{isColumnMode ? (
						<TbTable className="text-primary size-4" />
					) : (
						<TbAbc className="text-muted-foreground size-4" />
					)}
				</Button>
				<Tooltip.Content>
					{isColumnMode
						? "This side names a column. Click to compare against a fixed value instead."
						: "This side is a fixed value. Click to compare against another column instead."}
				</Tooltip.Content>
			</Tooltip>
		</div>
	);
}

export interface ConditionsBuilderRowProps {
	condition: Condition;
	index: number;
	isDisabled?: boolean;
	disableJsConditions?: boolean;
	ignoreOperators?: ConditionOperator[];
	lhsSuggestions?: string[];
	rhsSuggestions?: string[];
	allowColumnRefs?: boolean;
	onLHSChange: (index: number, value: ConditionValue) => void;
	onRHSChange: (index: number, value: ConditionValue) => void;
	onOperatorChange: (index: number, operator: ConditionOperator) => void;
	onJsChange: (index: number, value: string) => void;
	onRemoveCondition: (index: number) => void;
}

export function ConditionsBuilderRow({
	condition,
	index,
	isDisabled,
	disableJsConditions,
	ignoreOperators = [],
	lhsSuggestions,
	rhsSuggestions,
	allowColumnRefs,
	onLHSChange,
	onRHSChange,
	onOperatorChange,
	onJsChange,
	onRemoveCondition,
}: ConditionsBuilderRowProps) {
	const isJs = condition.operator === "js";
	const rhsIsColumn = sideIsColumn(condition.rhs, "rhs");
	const rhsText = conditionText(condition.rhs);
	const lhsIsColumn = sideIsColumn(condition.lhs, "lhs");
	const lhsText = conditionText(condition.lhs);

	const toggleRhsMode = useCallback(() => {
		onRHSChange(index, toggleSideMode(condition.rhs, "rhs"));
	}, [condition.rhs, index, onRHSChange]);

	const toggleLhsMode = useCallback(() => {
		onLHSChange(index, toggleSideMode(condition.lhs, "lhs"));
	}, [condition.lhs, index, onLHSChange]);
	const hideRhs =
		condition.operator === "is_empty" ||
		condition.operator === "is_not_empty";

	const availableOperators = useMemo(() => {
		return ALL_OPERATORS.filter((op) => {
			if (disableJsConditions && op.value === "js") return false;
			if (ignoreOperators.includes(op.value)) return false;
			return true;
		});
	}, [disableJsConditions, ignoreOperators]);

	const handleOperatorSelect = useCallback(
		(value: unknown) => {
			if (!value) return;
			onOperatorChange(index, String(value) as ConditionOperator);
		},
		[index, onOperatorChange],
	);

	const jsFieldValue = useMemo(() => {
		const raw = condition.js || "";
		return isJsExpression(raw) ? raw : writeExpression(raw);
	}, [condition.js]);

	return (
		<div className="flex flex-col gap-2 w-full">
			{condition.chain === "or" && (
				<div className="flex items-center gap-3 my-1">
					<div className="h-px flex-1 bg-border" />
					<span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
						OR
					</span>
					<div className="h-px flex-1 bg-border" />
				</div>
			)}

			{isJs ? (
				<div className="flex flex-row items-center gap-2 w-full">
					<div className="flex-1 min-w-0">
						<JsTextField
							fullWidth
							isDisabled={isDisabled}
							onChange={(val) => onJsChange(index, readExpression(val))}
							placeholder="JavaScript expression"
							value={jsFieldValue}
						/>
					</div>
					<div className="grid grid-cols-1 w-20 shrink-0">
						<Select
							fullWidth
							isDisabled={isDisabled}
							onChange={handleOperatorSelect}
							value={condition.operator}
							variant="secondary"
						>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{availableOperators.map((op) => (
										<ListBox.Item
											key={op.value}
											id={op.value}
											textValue={op.label}
										>
											{op.label}
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					</div>
					{!isDisabled && (
						<div className="shrink-0 flex items-center justify-center">
							<Button
								aria-label="Remove condition"
								isIconOnly
								isDisabled={isDisabled}
								size="sm"
								variant="ghost"
								onPress={() => onRemoveCondition(index)}
							>
								<TbMinus className="text-danger size-4" />
							</Button>
						</div>
					)}
				</div>
			) : (
				<div className="flex flex-row items-center gap-2 w-full">
					<div className="flex-1 min-w-0">
						<JsTextField
							fullWidth
							isDisabled={isDisabled}
							// a column names a field; it is never itself code
							disableJs={allowColumnRefs && lhsIsColumn}
							onChange={(val) => onLHSChange(index, encodeSide(val, condition.lhs, "lhs"))}
							placeholder={lhsIsColumn ? "Column" : "Left value"}
							value={lhsText}
							// suggesting column names while a literal is being typed only
							// misleads, so they are offered in column mode alone
							suggestions={
								allowColumnRefs && !lhsIsColumn ? undefined : lhsSuggestions
							}
						/>
					</div>
					{allowColumnRefs && (
						<ModeToggle
							isColumnMode={lhsIsColumn}
							isDisabled={isDisabled}
							onToggle={toggleLhsMode}
						/>
					)}
					<div className={hideRhs ? "flex-1 min-w-0" : "grid grid-cols-1 w-20 shrink-0"}>
						<Select
							fullWidth
							isDisabled={isDisabled}
							onChange={handleOperatorSelect}
							value={condition.operator}
							variant="secondary"
						>
							<Select.Trigger>
								<Select.Value />
								<Select.Indicator />
							</Select.Trigger>
							<Select.Popover>
								<ListBox>
									{availableOperators.map((op) => (
										<ListBox.Item
											key={op.value}
											id={op.value}
											textValue={op.label}
										>
											{op.label}
											<ListBox.ItemIndicator />
										</ListBox.Item>
									))}
								</ListBox>
							</Select.Popover>
						</Select>
					</div>
					{!hideRhs && (
						<div className="flex-1 min-w-0">
							<JsTextField
								fullWidth
								isDisabled={isDisabled}
								// a column reference names a field; it is never itself code
								disableJs={rhsIsColumn}
								onChange={(val) => onRHSChange(index, encodeSide(val, condition.rhs, "rhs"))}
								placeholder={rhsIsColumn ? "Column to compare against" : "Right value"}
								value={rhsText}
								// suggesting column names while a literal is being typed only
								// misleads, so they are offered in column mode alone
								suggestions={
									allowColumnRefs && !rhsIsColumn ? undefined : rhsSuggestions
								}
							/>
						</div>
					)}
					{!hideRhs && allowColumnRefs && (
						<ModeToggle
							isColumnMode={rhsIsColumn}
							isDisabled={isDisabled}
							onToggle={toggleRhsMode}
						/>
					)}
					{!isDisabled && (
						<div className="shrink-0 flex items-center justify-center">
							<Button
								aria-label="Remove condition"
								isIconOnly
								isDisabled={isDisabled}
								size="sm"
								variant="ghost"
								onPress={() => onRemoveCondition(index)}
							>
								<TbMinus className="text-danger size-4" />
							</Button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
