import type { ComponentProps, ReactNode } from "react";
import { Button } from "@heroui/react";
import { TbTrash } from "react-icons/tb";

export type DeleteIconButtonProps = Omit<ComponentProps<typeof Button>, "isIconOnly"> & {
	icon?: ReactNode;
	iconSize?: number;
};

export function DeleteIconButton({
	icon,
	iconSize = 16,
	variant = "danger-soft",
	size,
	className,
	children,
	...props
}: DeleteIconButtonProps) {
	return (
		<Button
			isIconOnly
			variant={variant}
			size={size}
			className={className}
			{...props}
		>
			{(renderProps) =>
				children != null
					? typeof children === "function"
						? children(renderProps)
						: children
					: (icon ?? <TbTrash size={iconSize} />)
			}
		</Button>
	);
}
