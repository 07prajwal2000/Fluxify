import { Button } from "@heroui/react";
import { useState } from "react";
import { TbArrowDown, TbArrowUp, TbPlus, TbTrash } from "react-icons/tb";
import type { JsonArray, JsonValue, JsonValueType } from "./types";
import { JsonCollectionShell } from "./JsonCollectionShell";
import { JsonTypeSelect } from "./JsonTypeSelect";
import { JsonValueEditor } from "./JsonValueEditor";
import {
	createDefaultJsonValue,
	getJsonValueType,
	moveArrayItem,
} from "./utils";

interface JsonArrayEditorProps {
	value: JsonArray;
	onChange: (value: JsonArray) => void;
	isReadOnly: boolean;
	allowExpressions: boolean;
	depth: number;
}

export function JsonArrayEditor({
	value,
	onChange,
	isReadOnly,
	allowExpressions,
	depth,
}: JsonArrayEditorProps) {
	const [newValueType, setNewValueType] = useState<JsonValueType>("string");

	const updateItem = (index: number, nextValue: JsonValue) => {
		const next = [...value];
		next[index] = nextValue;
		onChange(next);
	};

	return (
		<JsonCollectionShell count={value.length} depth={depth} type="array">
			{value.length === 0 && (
				<p className="py-2 text-center text-xs text-muted">No items yet.</p>
			)}
			{value.map((item, index) => {
				const itemType = getJsonValueType(item);
				const isCollection = itemType === "object" || itemType === "array";
				const actions = !isReadOnly ? (
					<div className="flex items-center gap-0.5">
						<Button
							aria-label={`Move item ${index + 1} up`}
							isDisabled={index === 0}
							isIconOnly
							onPress={() => onChange(moveArrayItem(value, index, index - 1))}
							size="sm"
							variant="ghost"
						>
							<TbArrowUp aria-hidden="true" className="size-4" />
						</Button>
						<Button
							aria-label={`Move item ${index + 1} down`}
							isDisabled={index === value.length - 1}
							isIconOnly
							onPress={() => onChange(moveArrayItem(value, index, index + 1))}
							size="sm"
							variant="ghost"
						>
							<TbArrowDown aria-hidden="true" className="size-4" />
						</Button>
						<Button
							aria-label={`Delete item ${index + 1}`}
							isIconOnly
							onPress={() =>
								onChange(value.filter((_, itemIndex) => itemIndex !== index))
							}
							size="sm"
							variant="ghost"
						>
							<TbTrash aria-hidden="true" className="size-4 text-danger" />
						</Button>
					</div>
				) : null;

				return (
					<div
						className="flex min-w-0 flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface p-2"
						key={index}
					>
						<div
							className={isCollection ? "grid min-w-[28rem] items-start gap-2" : "grid min-w-[42rem] items-start gap-2"}
							style={{
								gridTemplateColumns: isCollection
									? "3rem minmax(10rem, 1fr) auto"
									: "3rem minmax(14rem, 1fr) minmax(9rem, 0.7fr) auto",
							}}
						>
							<span className="flex h-10 items-center justify-center rounded-full border border-border bg-surface-secondary px-2 font-mono text-xs text-muted">
								[{index}]
							</span>
							{!isCollection && (
								<JsonValueEditor
									allowExpressions={allowExpressions}
									depth={depth + 1}
									isReadOnly={isReadOnly}
									onChange={(nextValue) => updateItem(index, nextValue)}
									showTypeSelect={false}
									value={item}
								/>
							)}
							<JsonTypeSelect
								ariaLabel={`Type for array item ${index + 1}`}
								isDisabled={isReadOnly}
								onChange={(nextType) =>
									updateItem(index, createDefaultJsonValue(nextType))
								}
								value={itemType}
							/>
							{actions}
						</div>
						{isCollection && (
							<div className="ml-3 min-w-0">
								<JsonValueEditor
									allowExpressions={allowExpressions}
									depth={depth + 1}
									isReadOnly={isReadOnly}
									onChange={(nextValue) => updateItem(index, nextValue)}
									showTypeSelect={false}
									value={item}
								/>
							</div>
						)}
					</div>
				);
			})}

			{!isReadOnly && (
				<div
					className="grid min-w-[24rem] gap-2 rounded-[var(--radius)] border border-dashed border-border bg-surface-secondary p-2"
					style={{ gridTemplateColumns: "minmax(9rem, 1fr) minmax(9rem, 1fr)" }}
				>
					<JsonTypeSelect
						ariaLabel="New array item type"
						onChange={setNewValueType}
						value={newValueType}
					/>
					<Button
						fullWidth
						onPress={() => onChange([...value, createDefaultJsonValue(newValueType)])}
						size="sm"
						variant="secondary"
					>
						<TbPlus aria-hidden="true" className="size-4" />
						Add item
					</Button>
				</div>
			)}
		</JsonCollectionShell>
	);
}
