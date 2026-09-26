import { Button, ListBox, Select, Tooltip } from "@heroui/react";
import { useCallback, useMemo } from "react";
import { TbAbc, TbMinus, TbTable } from "react-icons/tb";
import { JavaScriptTextArea } from "../JavaScriptTextArea/lazy";
import {
	type FieldInfo,
	FieldInfoButton,
	isJsExpression,
	JsTextField,
	readExpression,
	writeExpression,
} from "../JsTextField";
import { OrDivider } from "./ConditionsGroupRow";
import {
	ALL_OPERATORS,
	type OperatorOption,
	VALUE_PLACEHOLDERS,
	VALUELESS_OPERATORS,
} from "./constants";
import type { Condition, ConditionOperator, ConditionValue, CustomConditionEditor } from "./types";
import { conditionText, encodeSide, sideIsColumn, toggleSideMode } from "./utils";

const SQL_INFO: FieldInfo = {
	content: (
		<>
			Written as-is into the WHERE clause. Put run-time values in <code>{"{{ }}"}</code>: they are
			sent as parameters, and the condition is skipped when one is undefined.
		</>
	),
	example: "tags @> {{ input.tags }}",
};
const MONGO_INFO: FieldInfo = {
	content: "Return a MongoDB query filter object; returning undefined skips it.",
	example: "return { age: { $gte: 18 } }",
	docsUrl: "https://www.mongodb.com/docs/manual/tutorial/query-documents/",
};

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

function OperatorSelect({
	value,
	options,
	isDisabled,
	onChange,
}: {
	value: ConditionOperator;
	options: OperatorOption[];
	isDisabled?: boolean;
	onChange: (value: unknown) => void;
}) {
	return (
		<Select fullWidth isDisabled={isDisabled} onChange={onChange} value={value} variant="secondary">
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{options.map((op) => (
						<ListBox.Item key={op.value} id={op.value} textValue={op.label}>
							{op.label}
							<ListBox.ItemIndicator />
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}

/**
 * A hand-written condition in the connection's own language. SQL is edited
 * inline; a MongoDB filter is JS, so it gets the regular expression field.
 */
function CustomCondition({
	editor,
	raw,
	isDisabled,
	onChange,
}: {
	editor: CustomConditionEditor;
	raw?: string;
	isDisabled?: boolean;
	onChange: (raw: string) => void;
}) {
	const isSql = editor === "sql";
	return (
		<div className="flex flex-col gap-1 w-full">
			<div className="flex items-center gap-1">
				<span className="px-1.5 py-0.5 rounded bg-surface-secondary text-muted-foreground border border-border text-[10px] font-mono font-semibold uppercase leading-none select-none">
					{isSql ? "Custom SQL" : "Mongo filter"}
				</span>
				<FieldInfoButton
					label={isSql ? "Custom SQL" : "Mongo filter"}
					info={isSql ? SQL_INFO : MONGO_INFO}
				/>
			</div>
			{isSql ? (
				<JavaScriptTextArea
					aria-label="Custom SQL condition"
					language="sql"
					rows={2}
					showLineNumbers={false}
					wordWrap
					readOnly={isDisabled}
					value={raw ?? ""}
					onChange={onChange}
				/>
			) : (
				<JsTextField
					fullWidth
					isDisabled={isDisabled}
					placeholder="return { age: { $gte: 18 } }"
					// always code: a filter object can only come from JS
					value={isJsExpression(raw) ? raw! : writeExpression(raw ?? "")}
					onChange={(val) => onChange(writeExpression(readExpression(val)))}
				/>
			)}
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
	customConditionEditor?: CustomConditionEditor;
	onLHSChange: (index: number, value: ConditionValue) => void;
	onRHSChange: (index: number, value: ConditionValue) => void;
	onOperatorChange: (index: number, operator: ConditionOperator) => void;
	onJsChange: (index: number, value: string) => void;
	onRawChange: (index: number, raw: string) => void;
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
	customConditionEditor,
	onLHSChange,
	onRHSChange,
	onOperatorChange,
	onJsChange,
	onRawChange,
	onRemoveCondition,
}: ConditionsBuilderRowProps) {
	const isJs = condition.operator === "js";
	// a stored custom condition whose connection is unknown still shows as SQL
	const customEditor = condition.operator === "raw" ? (customConditionEditor ?? "sql") : undefined;
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
	const hideRhs = VALUELESS_OPERATORS.includes(condition.operator);

	const availableOperators = useMemo(() => {
		return ALL_OPERATORS.filter((op) => {
			if (disableJsConditions && op.value === "js") return false;
			if (!customConditionEditor && op.value === "raw") return false;
			if (ignoreOperators.includes(op.value)) return false;
			// only db blocks set a custom editor, and "js" is the MongoDB one
			if (op.scope === "db" && !customConditionEditor) return false;
			if (op.scope === "mongo" && customConditionEditor !== "js") return false;
			return true;
		});
	}, [disableJsConditions, ignoreOperators, customConditionEditor]);

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

	const operatorSelect = (
		<OperatorSelect
			isDisabled={isDisabled}
			options={availableOperators}
			value={condition.operator}
			onChange={handleOperatorSelect}
		/>
	);

	const removeButton = !isDisabled && (
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
	);

	return (
		<div className="flex flex-col gap-2 w-full">
			{condition.chain === "or" && <OrDivider />}

			{customEditor ? (
				<div className="flex flex-row items-start gap-2 w-full">
					<div className="flex-1 min-w-0">
						<CustomCondition
							editor={customEditor}
							isDisabled={isDisabled}
							raw={condition.raw}
							onChange={(raw) => onRawChange(index, raw)}
						/>
					</div>
					<div className="grid grid-cols-1 w-24 shrink-0">{operatorSelect}</div>
					{removeButton}
				</div>
			) : isJs ? (
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
					<div className="grid grid-cols-1 w-20 shrink-0">{operatorSelect}</div>
					{removeButton}
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
							suggestions={allowColumnRefs && !lhsIsColumn ? undefined : lhsSuggestions}
						/>
					</div>
					{allowColumnRefs && (
						<ModeToggle
							isColumnMode={lhsIsColumn}
							isDisabled={isDisabled}
							onToggle={toggleLhsMode}
						/>
					)}
					<div className={hideRhs ? "flex-1 min-w-0" : "grid grid-cols-1 w-28 shrink-0"}>
						{operatorSelect}
					</div>
					{!hideRhs && (
						<div className="flex-1 min-w-0">
							<JsTextField
								fullWidth
								isDisabled={isDisabled}
								// a column reference names a field; it is never itself code
								disableJs={rhsIsColumn}
								onChange={(val) => onRHSChange(index, encodeSide(val, condition.rhs, "rhs"))}
								placeholder={
									rhsIsColumn
										? "Column to compare against"
										: (VALUE_PLACEHOLDERS[condition.operator] ?? "Right value")
								}
								value={rhsText}
								// suggesting column names while a literal is being typed only
								// misleads, so they are offered in column mode alone
								suggestions={allowColumnRefs && !rhsIsColumn ? undefined : rhsSuggestions}
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
					{removeButton}
				</div>
			)}
		</div>
	);
}
