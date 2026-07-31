import { Button } from "@fluxify/components";
import { TbSparkles } from "react-icons/tb";
import clsx from "clsx";

export type AiCanvasButtonProps = {
	/** Click/press handler, e.g. to open AI assistant panel or route */
	onPress?: () => void;
	onClick?: () => void;
	/** Optional additional CSS classes */
	className?: string;
	/** Accessible label */
	"aria-label"?: string;
};

/**
 * A square-rounded floating AI icon button positioned at the bottom right of the canvas.
 * Uses the TbSparkles AI icon styled with primary theme color.
 */
export function AiCanvasButton({
	onPress,
	onClick,
	className,
	"aria-label": ariaLabel = "Open AI Assistant",
}: AiCanvasButtonProps) {
	return (
		<div className="absolute bottom-4 right-4 z-30">
			<Button
				isIconOnly
				aria-label={ariaLabel}
				variant="secondary"
				className={clsx(
					"size-10 rounded-xl border border-[#161820] bg-[#141720] p-0 shadow-lg backdrop-blur-md hover:bg-[#1c202d] transition-all",
					className,
				)}
				onPress={onPress}
				onClick={onClick}
			>
				<TbSparkles className="size-5 text-[#D0F237] shrink-0" />
			</Button>
		</div>
	);
}
