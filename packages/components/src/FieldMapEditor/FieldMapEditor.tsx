import { Button, Description, Label } from "@heroui/react";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { TbAlertCircle, TbPlus } from "react-icons/tb";
import { FieldMapEditorRow } from "./FieldMapEditorRow";
import type { FieldMapEditorProps } from "./types";

export function FieldMapEditor({
	fieldMap,
	onKeyValueChange,
	label,
	description,
	isDisabled,
	className,
}: FieldMapEditorProps) {
	const [tempFieldMap, setTempFieldMap] = useState<[string, string][]>(() =>
		Object.keys(fieldMap || {}).map((key) => [key, fieldMap[key] ?? ""]),
	);
	const [addError, setAddError] = useState<string | null>(null);

	// Ref tracking serialized map to prevent external sync from overwriting duplicate entries in local state
	const lastEmittedMapRef = useRef<string>("");

	const generateFieldMap = useCallback((list: [string, string][]): Record<string, string> => {
		const map: Record<string, string> = {};
		for (let i = 0; i < list.length; i++) {
			const tuple = list[i];
			if (tuple && tuple[0].trim() !== "") {
				map[tuple[0]] = tuple[1];
			}
		}
		return map;
	}, []);

	// Sync with external fieldMap prop only when changed from outside
	useEffect(() => {
		const currentEmitted = lastEmittedMapRef.current;
		const incomingSerialized = JSON.stringify(fieldMap || {});

		if (currentEmitted && currentEmitted === incomingSerialized) {
			return;
		}

		setTempFieldMap(
			Object.keys(fieldMap || {}).map((key) => [key, fieldMap[key] ?? ""]),
		);
	}, [fieldMap]);

	const emitChange = useCallback(
		(nextList: [string, string][]) => {
			const map = generateFieldMap(nextList);
			lastEmittedMapRef.current = JSON.stringify(map);
			onKeyValueChange?.(map);
		},
		[generateFieldMap, onKeyValueChange],
	);

	const handleKeyChange = useCallback(
		(index: number, key: string) => {
			setAddError(null);
			setTempFieldMap((prev) => {
				const next: [string, string][] = prev.map((item, i) =>
					i === index ? [key, item[1]] : [...item],
				);
				emitChange(next);
				return next;
			});
		},
		[emitChange],
	);

	const handleValueChange = useCallback(
		(index: number, value: string) => {
			setAddError(null);
			setTempFieldMap((prev) => {
				const next: [string, string][] = prev.map((item, i) =>
					i === index ? [item[0], value] : [...item],
				);
				emitChange(next);
				return next;
			});
		},
		[emitChange],
	);

	const handleAddNewFieldMap = useCallback(() => {
		// Check if an empty row already exists
		const hasEmptyRow = tempFieldMap.some(
			([k, v]) => k.trim() === "" && v.trim() === "",
		);

		if (hasEmptyRow) {
			setAddError(
				"Adding a new field map is not allowed while an empty entry exists. Please fill in the existing fields first.",
			);
			return;
		}

		setAddError(null);
		setTempFieldMap((prev) => {
			const next: [string, string][] = [...prev, ["", ""]];
			emitChange(next);
			return next;
		});
	}, [tempFieldMap, emitChange]);

	const handleDeleteFieldMap = useCallback(
		(index: number) => {
			setAddError(null);
			setTempFieldMap((prev) => {
				const next = prev.filter((_, i) => i !== index);
				emitChange(next);
				return next;
			});
		},
		[emitChange],
	);

	const containsDuplicate = useCallback(
		(type: "key" | "value", value: string): string | false => {
			if (!value.trim()) return false;
			let count = 0;
			const colIndex = type === "key" ? 0 : 1;
			for (let i = 0; i < tempFieldMap.length; i++) {
				if (tempFieldMap[i]?.[colIndex] === value) {
					count++;
				}
				if (count > 1) {
					return `Duplicate ${type}`;
				}
			}
			return false;
		},
		[tempFieldMap],
	);

	return (
		<div className={clsx("flex flex-col gap-3 w-full", className)}>
			{label && <Label className="text-sm font-medium">{label}</Label>}
			{description && (
				<Description className="text-xs text-muted">{description}</Description>
			)}

			<div className="flex flex-col gap-2.5 w-full">
				{tempFieldMap.map((kv, i) => (
					<FieldMapEditorRow
						key={i}
						destinationValue={kv[1]}
						index={i}
						isDisabled={isDisabled}
						keyError={containsDuplicate("key", kv[0])}
						onDelete={handleDeleteFieldMap}
						onKeyChange={handleKeyChange}
						onValueChange={handleValueChange}
						sourceKey={kv[0]}
						valueError={containsDuplicate("value", kv[1])}
					/>
				))}
			</div>

			<div className="flex flex-col gap-1.5 items-start">
				<Button
					isDisabled={isDisabled}
					size="sm"
					variant="secondary"
					className="mt-1"
					onPress={handleAddNewFieldMap}
				>
					<TbPlus className="size-4 mr-1" /> Add New Field Map
				</Button>
				{addError && (
					<div className="flex items-center gap-1.5 text-xs text-danger font-medium mt-1">
						<TbAlertCircle className="size-4 shrink-0" />
						<span>{addError}</span>
					</div>
				)}
			</div>
		</div>
	);
}
