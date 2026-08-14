import { Button } from "@fluxify/components";
import { TbArrowDown } from "react-icons/tb";

interface Props {
	isVisible: boolean;
	onClick: () => void;
}

export function ScrollToBottomButton({ isVisible, onClick }: Props) {
	if (!isVisible) return null;

	return (
		<div className="absolute left-1/2 -top-12 -translate-x-1/2 z-50">
			<Button
				isIconOnly
				variant="outline"
				className="h-8 w-8 rounded-full shadow-md text-foreground bg-surface border-border hover:bg-surface-secondary"
				onPress={onClick}
				aria-label="Scroll to bottom"
			>
				<TbArrowDown size={18} />
			</Button>
		</div>
	);
}
