export type FieldMapEditorProps = {
	/** Object representing source to destination field mappings */
	fieldMap: Record<string, string>;
	/** Callback fired when key or value changes, or rows are added/deleted */
	onKeyValueChange?: (data: Record<string, string>) => void;
	/** Optional section header label */
	label?: string;
	/** Optional helper description text */
	description?: string;
	/** Placeholder for each mapping's key input. */
	keyPlaceholder?: string;
	/** Placeholder for each mapping's value input. */
	valuePlaceholder?: string;
	/** Whether the inputs and action buttons are disabled */
	isDisabled?: boolean;
	/** Optional CSS class name for outer container */
	className?: string;
};

export type FieldMapEditorRowProps = {
	index: number;
	sourceKey: string;
	destinationValue: string;
	keyPlaceholder?: string;
	valuePlaceholder?: string;
	keyError?: string | false;
	valueError?: string | false;
	isDisabled?: boolean;
	onKeyChange: (index: number, key: string) => void;
	onValueChange: (index: number, value: string) => void;
	onDelete: (index: number) => void;
};
