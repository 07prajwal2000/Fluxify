import { Button, ListBox, Select } from "@heroui/react";
import { useCallback, useMemo } from "react";
import { TbMinus } from "react-icons/tb";
import { isJsExpression, JsTextField, readExpression, writeExpression } from "../JsTextField";
import { ALL_OPERATORS } from "./constants";
import type { Condition, ConditionOperator } from "./types";

export interface ConditionsBuilderRowProps {
	condition: Condition;
	index: number;
	isDisabled?: boolean;
	disableJsConditions?: boolean;
	ignoreOperators?: ConditionOperator[];
	onLHSChange: (index: number, value: string) => void;
	onRHSChange: (index: number, value: string) => void;
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
	onLHSChange,
	onRHSChange,
	onOperatorChange,
	onJsChange,
	onRemoveCondition,
}: ConditionsBuilderRowProps) {
	const isJs = condition.operator === "js";
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
					<div className="w-52 shrink-0">
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
							onChange={(val) => onLHSChange(index, val)}
							placeholder="Left value"
							value={String(condition.lhs ?? "")}
						/>
					</div>
					<div className={hideRhs ? "flex-1 min-w-0" : "w-52 shrink-0"}>
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
								onChange={(val) => onRHSChange(index, val)}
								placeholder="Right value"
								value={String(condition.rhs ?? "")}
							/>
						</div>
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
