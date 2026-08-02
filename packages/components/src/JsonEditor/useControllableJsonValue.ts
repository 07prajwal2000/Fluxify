import { useCallback, useState } from "react";
import type { JsonContainer, JsonEditorBaseProps } from "./types";
import { createDefaultJsonRoot } from "./utils";

type ControllableJsonValue = readonly [
	value: JsonContainer,
	setValue: (value: JsonContainer) => void,
];

export function useControllableJsonValue({
	value,
	defaultValue,
	rootType = "object",
	onChange,
}: Pick<
	JsonEditorBaseProps,
	"value" | "defaultValue" | "rootType" | "onChange"
>): ControllableJsonValue {
	const [internalValue, setInternalValue] = useState<JsonContainer>(() =>
		defaultValue ?? createDefaultJsonRoot(rootType),
	);
	const currentValue = value ?? internalValue;

	const setValue = useCallback(
		(nextValue: JsonContainer) => {
			if (value === undefined) setInternalValue(nextValue);
			onChange?.(nextValue);
		},
		[value, onChange],
	);

	return [currentValue, setValue] as const;
}

