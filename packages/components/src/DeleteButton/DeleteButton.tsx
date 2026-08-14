import type { ComponentProps, ReactNode } from "react";
import { Button } from "@heroui/react";
import { TbTrash } from "react-icons/tb";

export type DeleteButtonProps = ComponentProps<typeof Button> & {
	icon?: ReactNode;
	iconSize?: number;
	showIcon?: boolean;
};

export function DeleteButton({
	icon,
	iconSize = 16,
	showIcon = true,
	variant = "danger-soft",
	children,
	...props
}: DeleteButtonProps) {
	return (
		<Button
			variant={variant}
			{...props}
		>
			{(renderProps) => (
				<>
					{showIcon && (icon ?? <TbTrash size={iconSize} />)}
					{typeof children === "function" ? children(renderProps) : children}
				</>
			)}
		</Button>
	);
}
