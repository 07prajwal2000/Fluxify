import { Button, InputGroup, TextField } from "@heroui/react";
import { TbLink, TbMinus } from "react-icons/tb";
import type { FieldMapEditorRowProps } from "./types";

export function FieldMapEditorRow({
	index,
	sourceKey,
	destinationValue,
	keyError,
	valueError,
	isDisabled,
	onKeyChange,
	onValueChange,
	onDelete,
}: FieldMapEditorRowProps) {
	return (
		<div className="flex flex-row items-start gap-2 w-full">
			<div className="flex-1 min-w-0">
				<TextField
					fullWidth
					isDisabled={isDisabled}
					isInvalid={Boolean(keyError)}
					variant="secondary"
				>
					<InputGroup variant="secondary" className="w-full">
						<InputGroup.Input
							placeholder="Source Field"
							value={sourceKey}
							onChange={(e) => onKeyChange(index, e.target.value)}
						/>
					</InputGroup>
					{keyError && (
						<span className="text-xs text-danger mt-1 block">
							{keyError}
						</span>
					)}
				</TextField>
			</div>

			<div className="h-10 flex items-center justify-center text-muted shrink-0 px-1">
				<TbLink className="size-4" />
			</div>

			<div className="flex-1 min-w-0">
				<TextField
					fullWidth
					isDisabled={isDisabled}
					isInvalid={Boolean(valueError)}
					variant="secondary"
				>
					<InputGroup variant="secondary" className="w-full">
						<InputGroup.Input
							placeholder="Destination Field"
							value={destinationValue}
							onChange={(e) => onValueChange(index, e.target.value)}
						/>
					</InputGroup>
					{valueError && (
						<span className="text-xs text-danger mt-1 block">
							{valueError}
						</span>
					)}
				</TextField>
			</div>

			<div className="h-10 flex items-center justify-center shrink-0">
				<Button
					aria-label="Remove field map"
					isIconOnly
					isDisabled={isDisabled}
					size="sm"
					variant="ghost"
					onPress={() => onDelete(index)}
				>
					<TbMinus className="text-danger size-4" />
				</Button>
			</div>
		</div>
	);
}
