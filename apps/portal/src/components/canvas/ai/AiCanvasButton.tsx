import { Button } from "@fluxify/components";
import clsx from "clsx";
import { TbSparkles } from "react-icons/tb";
import { useCanvasAi } from "./CanvasAiContext";
import { CanvasChatPanel } from "./CanvasChatPanel";
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
 * Uses the TbSparkles AI icon styled with primary theme color. On a canvas wired
 * to the AI (`CanvasAiProvider`) it opens and closes the agent chat above it.
 */
export function AiCanvasButton({
	onPress,
	onClick,
	className,
	"aria-label": ariaLabel,
}: AiCanvasButtonProps) {
	const chat = useCanvasAi()?.chat;
	return (
		<>
			<CanvasChatPanel />
			<div className="absolute bottom-4 right-4 z-30">
				<Button
					isIconOnly
					aria-label={ariaLabel ?? (chat?.isOpen ? "Close AI chat" : "Open AI Assistant")}
					aria-expanded={chat ? chat.isOpen : undefined}
					variant="ghost"
					className={clsx("fx-ai-canvas-button", className)}
					onPress={onPress ?? chat?.toggle}
					onClick={onClick}
				>
					<TbSparkles className="fx-ai-canvas-button__icon" />
				</Button>
			</div>
		</>
	);
}
