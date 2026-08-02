import { Button, Description, Label, ListBox, Select } from "@heroui/react";
import clsx from "clsx";
import { useCallback } from "react";
import { TbMinus, TbPlus } from "react-icons/tb";
import { JsTextField } from "../JsTextField";
import type { JoinItem, JoinsEditorProps, JoinType } from "./types";

const JOIN_TYPE_OPTIONS: { value: JoinType; label: string }[] = [
	{ value: "left", label: "Left Join" },
	{ value: "inner", label: "Inner Join" },
	{ value: "right", label: "Right Join" },
	{ value: "outer", label: "Outer Join" },
];

export function JoinsEditor({
	label = "Joins (Optional)",
	description = "Configure table joins for the query",
	joins = [],
	onChange,
	isDisabled,
	readOnly,
	className,
	emptyMessage = "No joins added",
}: JoinsEditorProps) {
	const disabled = Boolean(isDisabled || readOnly);

	const handleUpdate = useCallback(
		(index: number, patch: Partial<JoinItem>) => {
			if (!onChange) return;
			const next = joins.map((j, i) => (i === index ? { ...j, ...patch } : j));
			onChange(next);
		},
		[joins, onChange],
	);

	const handleRemove = useCallback(
		(index: number) => {
			if (!onChange) return;
			const next = joins.filter((_, i) => i !== index);
			onChange(next);
		},
		[joins, onChange],
	);

	const handleAdd = useCallback(() => {
		if (!onChange) return;
		onChange([...joins, { type: "left", table: "", attribute: "" }]);
	}, [joins, onChange]);

	return (
		<div className={clsx("flex flex-col gap-2.5 w-full", className)}>
			{label && (
				<Label className="text-sm font-medium text-foreground">{label}</Label>
			)}
			{description && (
				<Description className="text-xs text-muted-foreground -mt-1">
					{description}
				</Description>
			)}

			<div className="flex flex-col gap-2.5 w-full">
				{joins.length === 0 ? (
					<p className="text-xs text-muted-foreground py-2 text-center">
						{emptyMessage}
					</p>
				) : (
					joins.map((join, index) => {
						const rawAttr = join.attribute || "";
						const equalsIndex = rawAttr.indexOf("=");
						const leftAttr =
							equalsIndex !== -1
								? rawAttr.slice(0, equalsIndex).trim()
								: rawAttr;
						const rightAttr =
							equalsIndex !== -1
								? rawAttr.slice(equalsIndex + 1).trim()
								: "";

						return (
							<div
								key={index}
								className="flex flex-row items-center gap-2 w-full min-w-0"
							>
								{/* Card with 2 rows */}
								<div className="flex-1 min-w-0 flex flex-col gap-2 p-2.5 rounded-lg border border-border bg-surface-secondary/40">
									{/* Row 1: Dropdown + Table */}
									<div className="flex flex-row items-center gap-2 w-full min-w-0">
										<div className="w-48 shrink-0">
											<Select
												fullWidth
												isDisabled={disabled}
												onChange={(val) =>
													handleUpdate(index, {
														type: (val as JoinType) || "left",
													})
												}
												value={join.type || "left"}
												variant="secondary"
											>
												<Select.Trigger>
													<Select.Value />
													<Select.Indicator />
												</Select.Trigger>
												<Select.Popover>
													<ListBox>
														{JOIN_TYPE_OPTIONS.map((opt) => (
															<ListBox.Item
																key={opt.value}
																id={opt.value}
																textValue={opt.label}
															>
																{opt.label}
																<ListBox.ItemIndicator />
															</ListBox.Item>
														))}
													</ListBox>
												</Select.Popover>
											</Select>
										</div>

										<div className="flex-1 min-w-0">
											<JsTextField
												fullWidth
												disableJs
												isDisabled={disabled}
												placeholder="Table (e.g. orders)"
												value={join.table || ""}
												onChange={(val) => handleUpdate(index, { table: val })}
												variant="secondary"
											/>
										</div>
									</div>

									{/* Row 2: Condition inputs (leftAttr = rightAttr) */}
									<div className="flex flex-row items-center gap-2 w-full min-w-0">
										<div className="flex-1 min-w-0">
											<JsTextField
												fullWidth
												disableJs
												isDisabled={disabled}
												placeholder="users.id"
												value={leftAttr}
												onChange={(val) => {
													const newAttr = rightAttr
														? `${val} = ${rightAttr}`
														: val;
													handleUpdate(index, { attribute: newAttr });
												}}
												variant="secondary"
											/>
										</div>

										<span className="text-xs font-bold text-muted-foreground shrink-0 px-0.5">
											=
										</span>

										<div className="flex-1 min-w-0">
											<JsTextField
												fullWidth
												disableJs
												isDisabled={disabled}
												placeholder="orders.user_id"
												value={rightAttr}
												onChange={(val) => {
													const newAttr = `${leftAttr} = ${val}`;
													handleUpdate(index, { attribute: newAttr });
												}}
												variant="secondary"
											/>
										</div>
									</div>
								</div>

								{/* Minus button outside the card */}
								{!disabled && (
									<div className="shrink-0 flex items-center justify-center">
										<Button
											aria-label={`Remove join ${index + 1}`}
											isIconOnly
											isDisabled={disabled}
											size="sm"
											variant="ghost"
											onPress={() => handleRemove(index)}
										>
											<TbMinus className="text-danger size-4" />
										</Button>
									</div>
								)}
							</div>
						);
					})
				)}
			</div>

			{!disabled && (
				<div className="flex flex-col gap-1.5 items-start mt-1">
					<Button
						size="sm"
						variant="secondary"
						isDisabled={disabled}
						onPress={handleAdd}
					>
						<TbPlus className="size-4 mr-1" /> Add Another Join
					</Button>
				</div>
			)}
		</div>
	);
}
