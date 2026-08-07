import type { ReactNode } from "react";

export type MultiSelectOption = {
	value: string;
	label: string;
};

export type MultiSelectProps = {
	options: MultiSelectOption[];
	value: string[];
	onChange: (value: string[]) => void;
	label?: ReactNode;
	description?: ReactNode;
	placeholder?: string;
	isDisabled?: boolean;
	fullWidth?: boolean;
	variant?: "primary" | "secondary";
};
