import {
	CheckboxContent as HeroUICheckboxContent,
	CheckboxControl as HeroUICheckboxControl,
	CheckboxIndicator as HeroUICheckboxIndicator,
	CheckboxRoot as HeroUICheckboxRoot,
	Description,
} from "@heroui/react";
import type { ReactNode } from "react";
import type {
	CheckboxContentProps,
	CheckboxControlProps,
	CheckboxDescriptionProps,
	CheckboxIndicatorProps,
	CheckboxLabelProps,
	CheckboxProps,
	CheckboxRootProps,
} from "./types";

export const CheckboxRoot = HeroUICheckboxRoot;
export const CheckboxContent = HeroUICheckboxContent;
export const CheckboxControl = HeroUICheckboxControl;
export const CheckboxIndicator = HeroUICheckboxIndicator;
export const CheckboxDescription = Description;

export function CheckboxLabel({ children, className, ...props }: CheckboxLabelProps) {
	return <span className={className} {...props}>{children}</span>;
}

/**
 * Helper to determine if children contain HeroUI compound components.
 */
function isCompound(children: ReactNode): boolean {
	if (!children) return false;
	if (typeof children === "function") return true;
	if (Array.isArray(children)) {
		return children.some(isCompound);
	}
	if (typeof children === "object" && children !== null && "type" in children) {
		const type = (children as { type: unknown }).type;
		return (
			type === HeroUICheckboxContent ||
			type === HeroUICheckboxControl ||
			type === HeroUICheckboxIndicator ||
			type === HeroUICheckboxRoot
		);
	}
	return false;
}

/**
 * HeroUI Checkbox component supporting both compound usage:
 * ```tsx
 * <Checkbox name="my-checkbox">
 *   <Checkbox.Content>
 *     <Checkbox.Control className="size-4 rounded-full before:rounded-full">
 *       <Checkbox.Indicator />
 *     </Checkbox.Control>
 *     Label text
 *   </Checkbox.Content>
 * </Checkbox>
 * ```
 * and simple usage:
 * ```tsx
 * <Checkbox label="Label text" />
 * ```
 */
export function Checkbox({
	checked,
	isSelected,
	defaultChecked,
	defaultSelected,
	indeterminate,
	isIndeterminate,
	label,
	description,
	errorMessage,
	children,
	...props
}: CheckboxProps) {
	const effectiveIsSelected = isSelected ?? checked;
	const effectiveDefaultSelected = defaultSelected ?? defaultChecked;
	const effectiveIsIndeterminate = isIndeterminate ?? indeterminate;

	// HeroUI types children as a render-prop union; this component only ever
	// receives plain nodes.
	const childNodes = children as ReactNode;
	const hasCompoundChildren = isCompound(childNodes);

	return (
		<HeroUICheckboxRoot
			isSelected={effectiveIsSelected}
			defaultSelected={effectiveDefaultSelected}
			isIndeterminate={effectiveIsIndeterminate}
			{...props}
		>
			{hasCompoundChildren ? (
				childNodes
			) : (
				<>
					<HeroUICheckboxContent>
						<HeroUICheckboxControl>
							<HeroUICheckboxIndicator />
						</HeroUICheckboxControl>
						{label ?? childNodes}
					</HeroUICheckboxContent>
					{description && <Description>{description}</Description>}
					{errorMessage && (
						<span className="text-xs text-[var(--danger,#ef4444)] mt-0.5">
							{errorMessage}
						</span>
					)}
				</>
			)}
		</HeroUICheckboxRoot>
	);
}

Checkbox.displayName = "Checkbox";
Checkbox.Root = HeroUICheckboxRoot;
Checkbox.Content = HeroUICheckboxContent;
Checkbox.Control = HeroUICheckboxControl;
Checkbox.Indicator = HeroUICheckboxIndicator;
Checkbox.Label = CheckboxLabel;
Checkbox.Description = CheckboxDescription;
