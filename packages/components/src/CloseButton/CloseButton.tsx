import type { ComponentProps, ReactNode } from "react";
import { Button } from "@heroui/react";
import { TbX } from "react-icons/tb";
import { clsx } from "clsx";

export type CloseButtonProps = Omit<ComponentProps<typeof Button>, "isIconOnly"> & {
	icon?: ReactNode;
	iconSize?: number;
};

export function CloseButton({
	icon,
	iconSize = 18,
	variant = "ghost",
	size = "sm",
	slot = "close",
	className,
	children,
	"aria-label": ariaLabel = "Close",
	...props
}: CloseButtonProps) {
	return (
		<Button
			isIconOnly
			variant={variant}
			size={size}
			slot={slot}
			aria-label={ariaLabel}
			className={clsx(
				"text-muted hover:text-foreground hover:bg-surface-secondary active:bg-surface-secondary/80 rounded-md transition-colors",
				className,
			)}
			{...props}
		>
			{(renderProps) =>
				children != null
					? typeof children === "function"
						? children(renderProps)
						: children
					: (icon ?? <TbX size={iconSize} />)
			}
		</Button>
	);
}

export const ModalCloseButton = CloseButton;
export type ModalCloseButtonProps = CloseButtonProps;
