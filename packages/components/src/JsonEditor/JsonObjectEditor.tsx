import { Button, InputGroup, TextField } from "@heroui/react";
import { useEffect, useState } from "react";
import { TbPlus, TbTrash } from "react-icons/tb";
import type { JsonObject, JsonValue, JsonValueType } from "./types";
import { JsonCollectionShell } from "./JsonCollectionShell";
import { JsonTypeSelect } from "./JsonTypeSelect";
import { JsonValueEditor } from "./JsonValueEditor";
import {
	createDefaultJsonValue,
	getJsonValueType,
	getUniqueObjectKey,
	renameObjectKey,
} from "./utils";

interface JsonObjectEditorProps {
	value: JsonObject;
	onChange: (value: JsonObject) => void;
	isReadOnly: boolean;
	allowExpressions: boolean;
	depth: number;
}

interface ObjectKeyFieldProps {
	name: string;
	objectValue: JsonObject;
	isReadOnly: boolean;
	onRename: (name: string) => void;
}

function ObjectKeyField({
	name,
	objectValue,
	isReadOnly,
	onRename,
}: ObjectKeyFieldProps) {
	const [draftName, setDraftName] = useState(name);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => setDraftName(name), [name]);

	const commit = () => {
		if (draftName === name) {
			setError(null);
			return;
		}
		if (draftName in objectValue) {
			setError(`The key “${draftName}” already exists.`);
			return;
		}
		setError(null);
		onRename(draftName);
	};

	return (
		<TextField
			className="min-w-0"
			fullWidth
			isDisabled={isReadOnly}
			isInvalid={Boolean(error)}
			variant="secondary"
		>
			<InputGroup fullWidth variant="secondary">
				<InputGroup.Input
					aria-label={`Key ${name}`}
					className="font-mono text-xs"
					onBlur={commit}
					onChange={(event) => {
						setDraftName(event.currentTarget.value);
						setError(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
						}
					}}
					placeholder="Key"
					value={draftName}
				/>
			</InputGroup>
			{error && <span className="mt-1 block text-xs text-danger">{error}</span>}
		</TextField>
	);
}

export function JsonObjectEditor({
	value,
	onChange,
	isReadOnly,
	allowExpressions,
	depth,
}: JsonObjectEditorProps) {
	const [newKey, setNewKey] = useState("");
	const [newValueType, setNewValueType] = useState<JsonValueType>("string");
	const [addError, setAddError] = useState<string | null>(null);

	const updateEntry = (key: string, nextValue: JsonValue) => {
		onChange({ ...value, [key]: nextValue });
	};

	const addEntry = () => {
		const key = newKey.trim() ? newKey : getUniqueObjectKey(value);
		if (key in value) {
			setAddError(`The key “${key}” already exists.`);
			return;
		}
		onChange({ ...value, [key]: createDefaultJsonValue(newValueType) });
		setNewKey("");
		setNewValueType("string");
		setAddError(null);
	};

	return (
		<JsonCollectionShell count={Object.keys(value).length} depth={depth} type="object">
			{Object.entries(value).length === 0 && (
				<p className="py-2 text-center text-xs text-muted">No fields yet.</p>
			)}
			{Object.entries(value).map(([key, entryValue]) => {
				const valueType = getJsonValueType(entryValue);
				const isCollection = valueType === "object" || valueType === "array";
				const deleteButton = !isReadOnly ? (
					<Button
						aria-label={`Delete ${key}`}
						className="self-center"
						isIconOnly
						onPress={() => {
							const next = { ...value };
							delete next[key];
							onChange(next);
						}}
						size="sm"
						variant="ghost"
					>
						<TbTrash aria-hidden="true" className="size-4 text-danger" />
					</Button>
				) : (
					<span aria-hidden="true" className="size-8" />
				);

				return (
					<div className="flex min-w-0 flex-col gap-2" key={key}>
						{isCollection ? (
							<>
								<div
									className="grid min-w-[28rem] items-start gap-2"
									style={{
										gridTemplateColumns:
											"minmax(9rem, 0.8fr) 1.25rem minmax(10rem, 1fr) 2.5rem",
									}}
								>
									<ObjectKeyField
										isReadOnly={isReadOnly}
										name={key}
										objectValue={value}
										onRename={(nextKey) =>
											onChange(renameObjectKey(value, key, nextKey))
										}
									/>
									<span className="flex h-10 items-center justify-center font-mono text-sm text-muted">
										:
									</span>
									<JsonTypeSelect
										ariaLabel={`Type for ${key}`}
										isDisabled={isReadOnly}
										onChange={(nextType) =>
											updateEntry(key, createDefaultJsonValue(nextType))
										}
										value={valueType}
									/>
									{deleteButton}
								</div>
								<div className="ml-3 min-w-0">
									<JsonValueEditor
										allowExpressions={allowExpressions}
										depth={depth + 1}
										isReadOnly={isReadOnly}
										onChange={(nextValue) => updateEntry(key, nextValue)}
										showTypeSelect={false}
										value={entryValue}
									/>
								</div>
							</>
						) : (
							<div
								className="grid min-w-[42rem] items-start gap-2"
								style={{
									gridTemplateColumns:
										"minmax(9rem, 0.75fr) 1.25rem minmax(14rem, 1.25fr) minmax(9rem, 0.85fr) 2.5rem",
								}}
							>
								<ObjectKeyField
									isReadOnly={isReadOnly}
									name={key}
									objectValue={value}
									onRename={(nextKey) =>
										onChange(renameObjectKey(value, key, nextKey))
									}
								/>
								<span className="flex h-10 items-center justify-center font-mono text-sm text-muted">
									:
								</span>
								<JsonValueEditor
									allowExpressions={allowExpressions}
									depth={depth + 1}
									isReadOnly={isReadOnly}
									onChange={(nextValue) => updateEntry(key, nextValue)}
									showTypeSelect={false}
									value={entryValue}
								/>
								<JsonTypeSelect
									ariaLabel={`Type for ${key}`}
									isDisabled={isReadOnly}
									onChange={(nextType) =>
										updateEntry(key, createDefaultJsonValue(nextType))
									}
									value={valueType}
								/>
								{deleteButton}
							</div>
						)}
					</div>
				);
			})}

			{!isReadOnly && (
				<div className="flex min-w-0 flex-col gap-1.5 rounded-[var(--radius)] border border-dashed border-border bg-surface-secondary p-2">
					<div
						className="grid min-w-[32rem] gap-2"
						style={{
							gridTemplateColumns:
								"minmax(9rem, 1fr) minmax(9rem, 1fr) minmax(8rem, 1fr)",
						}}
					>
						<TextField fullWidth isInvalid={Boolean(addError)} variant="secondary">
							<InputGroup fullWidth variant="secondary">
								<InputGroup.Input
									aria-label="New JSON key"
									className="font-mono text-xs"
									onChange={(event) => {
										setNewKey(event.currentTarget.value);
										setAddError(null);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											addEntry();
										}
									}}
									placeholder={getUniqueObjectKey(value)}
									value={newKey}
								/>
							</InputGroup>
						</TextField>
						<JsonTypeSelect
							ariaLabel="New field type"
							onChange={setNewValueType}
							value={newValueType}
						/>
						<Button fullWidth onPress={addEntry} size="sm" variant="secondary">
							<TbPlus aria-hidden="true" className="size-4" />
							Add field
						</Button>
					</div>
					{addError && <span className="text-xs text-danger">{addError}</span>}
				</div>
			)}
		</JsonCollectionShell>
	);
}
