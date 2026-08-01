import type { ComponentPropsWithoutRef, ReactNode } from "react";
import type {
	CheckboxContentProps as HeroUICheckboxContentProps,
	CheckboxControlProps as HeroUICheckboxControlProps,
	CheckboxIndicatorProps as HeroUICheckboxIndicatorProps,
	CheckboxRootProps as HeroUICheckboxRootProps,
	Description,
} from "@heroui/react";

export type CheckboxSize = "sm" | "md" | "lg";
export type CheckboxVariant = "primary" | "secondary";

export interface CheckboxRenderProps {
	isSelected?: boolean;
	isIndeterminate?: boolean;
	isDisabled?: boolean;
	isReadOnly?: boolean;
	isInvalid?: boolean;
}

export interface CheckboxProps extends HeroUICheckboxRootProps {
	/** Controls whether the checkbox is checked (controlled mode). Alias for `isSelected`. */
	checked?: boolean;
	/** Initial checked status for uncontrolled mode. Alias for `defaultSelected`. */
	defaultChecked?: boolean;
	/** Puts the checkbox in an indeterminate / mixed state. Alias for `isIndeterminate`. */
	indeterminate?: boolean;
	/** Label to display next to the checkbox when not using compound children. */
	label?: ReactNode;
	/** Auxiliary description text displayed beneath the label. */
	description?: ReactNode;
	/** Error message displayed when `isInvalid` is true. */
	errorMessage?: ReactNode;
	/** Callback invoked when the checked state changes. */
	onChange?: (isSelected: boolean) => void;
}

export type CheckboxRootProps = HeroUICheckboxRootProps;
export type CheckboxContentProps = HeroUICheckboxContentProps;
export type CheckboxControlProps = HeroUICheckboxControlProps;
export type CheckboxIndicatorProps = HeroUICheckboxIndicatorProps;
export type CheckboxDescriptionProps = ComponentPropsWithoutRef<typeof Description>;
export interface CheckboxLabelProps extends ComponentPropsWithoutRef<"span"> {
	children?: ReactNode;
}
