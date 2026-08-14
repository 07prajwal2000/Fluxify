import { Button, InputGroup, TextField, Tooltip } from "@heroui/react";
import { IoLogoJavascript } from "react-icons/io5";
import { TbChevronRight, TbSettings, TbTrash } from "react-icons/tb";
import { Checkbox } from "../Checkbox";
import { CONTAINER_TYPES } from "./constants";
import { useSchemaEditorContext } from "./context";
import { DataTypeSelect } from "./DataTypeSelect";
import type { SchemaPath, SchemaProperty } from "./types";

interface PropertyRowProps {
	property: SchemaProperty;
	/** Full path to this property, used for overrides and mutations. */
	path: SchemaPath;
}

/** One `key : type` line. Containers navigate; everything else opens the drawer. */
export function PropertyRow({ property, path }: PropertyRowProps) {
	const {
		isReadOnly,
		removeProperty,
		updateProperty,
		openDrawer,
		goToPath,
		typeOptionsFor,
		hasTypeOverride,
		ruleEditors,
	} = useSchemaEditorContext();

	const isContainer = CONTAINER_TYPES.includes(property.dataType);
	const isJs = property.dataType === "js";
	// A type with no registered editor has nothing to open — `bool` today.
	const isConfigurable = isContainer || Boolean(ruleEditors[property.dataType]);

	// An override names the choices for this one field, so it stays live even
	// when the rest of the editor is locked.
	const typeIsEditable = !isReadOnly || hasTypeOverride(path);

	const update = (updates: Partial<SchemaProperty>) =>
		updateProperty(path, updates);

	const handleConfigure = () => {
		if (isContainer) goToPath(path);
		else openDrawer(path);
	};

	return (
		<div className="flex w-full flex-col gap-2 rounded-[var(--radius)] border border-border bg-surface p-2 sm:flex-row sm:items-center">
			<div className="min-w-0 flex-[2]">
				<TextField fullWidth isDisabled={isReadOnly} variant="secondary">
					<InputGroup fullWidth variant="secondary">
						<InputGroup.Input
							aria-label="Property key"
							onChange={(event) => update({ key: event.currentTarget.value })}
							placeholder="Property key"
							value={property.key}
						/>
					</InputGroup>
				</TextField>
			</div>

			<div className="min-w-0 flex-[2]">
				<DataTypeSelect
					isDisabled={!typeIsEditable}
					label={`Data type for ${property.key || "property"}`}
					onChange={(dataType) => update({ dataType })}
					options={typeOptionsFor(path)}
					value={property.dataType}
				/>
			</div>

			<div className="flex shrink-0 items-center gap-2 sm:w-40 sm:justify-end">
				<Checkbox
					isDisabled={isReadOnly}
					isSelected={property.required ?? true}
					label="Required"
					onChange={(next) => update({ required: next })}
				/>

				{isConfigurable ? (
					<Tooltip>
						<Button
							aria-label={
								isContainer
									? `Open ${property.key || "property"}`
									: `Configure ${property.key || "property"}`
							}
							isIconOnly
							onPress={handleConfigure}
							size="sm"
							variant="ghost"
						>
							{isContainer ? (
								<TbChevronRight className="size-4 text-accent" />
							) : isJs ? (
								<IoLogoJavascript className="size-4 text-accent" />
							) : (
								<TbSettings className="size-4 text-accent" />
							)}
						</Button>
						<Tooltip.Content>
							{isContainer
								? "Open this field to edit its shape"
								: isJs
									? "Write custom JavaScript validation"
									: "Configure validation rules"}
						</Tooltip.Content>
					</Tooltip>
				) : (
					// Keeps the action column aligned across rows.
					<span aria-hidden className="inline-block size-8" />
				)}

				{!isReadOnly && (
					<Button
						aria-label={`Remove ${property.key || "property"}`}
						isIconOnly
						onPress={() => removeProperty(path)}
						size="sm"
						variant="ghost"
					>
						<TbTrash className="size-4 text-danger" />
					</Button>
				)}
			</div>
		</div>
	);
}
