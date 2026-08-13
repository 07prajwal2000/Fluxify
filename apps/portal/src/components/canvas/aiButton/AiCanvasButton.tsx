import { Button } from "@fluxify/components";
import { TbSparkles } from "react-icons/tb";
import clsx from "clsx";
import "./aiCanvasButton.css";

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
				variant="ghost"
				className={clsx("fx-ai-canvas-button", className)}
				onPress={onPress}
				onClick={onClick}
			>
				<TbSparkles className="fx-ai-canvas-button__icon" />
			</Button>
		</div>
	);
}
