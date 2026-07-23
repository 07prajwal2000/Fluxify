import type { ReactNode } from "react";
import { cn } from "@fluxify/components";

type Props = {
	blockId: string;
	blockName: string;
	icon?: ReactNode;
	children?: ReactNode; // handles
	selected?: boolean;
	labelPlacement?: "top" | "bottom";
	topLeftRounded?: boolean;
	topRightRounded?: boolean;
	bottomLeftRounded?: boolean;
	bottomRightRounded?: boolean;
	color?: string;
};

// HeroUI/Tailwind port of the web BaseBlock: compact icon card with a label and
// per-corner rounding (entrypoint = rounded top, response = rounded bottom).
export function BaseBlock({
	blockName,
	icon,
	children,
	selected,
	labelPlacement = "top",
	topLeftRounded,
	topRightRounded,
	bottomLeftRounded,
	bottomRightRounded,
	color,
}: Props) {
	return (
		<div
			className={cn(
				"relative flex size-16 items-center justify-center border bg-surface text-foreground shadow transition-colors",
				selected ? "border-accent ring-2 ring-accent/40" : "border-border",
				topLeftRounded ? "rounded-tl-[20px]" : "rounded-tl-[4px]",
				topRightRounded ? "rounded-tr-[20px]" : "rounded-tr-[4px]",
				bottomLeftRounded ? "rounded-bl-[20px]" : "rounded-bl-[4px]",
				bottomRightRounded ? "rounded-br-[20px]" : "rounded-br-[4px]",
			)}
			style={color ? { color } : undefined}
		>
			{icon}
			{children}
			<span
				className={cn(
					"absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-medium text-muted",
					labelPlacement === "top" ? "-top-4" : "-bottom-4",
				)}
			>
				{blockName}
			</span>
		</div>
	);
}
