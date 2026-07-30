import { ControlButton } from "@xyflow/react";
import { TbLayoutDistributeVertical } from "react-icons/tb";
import { useCanvasFormat } from "./FormatContext";

/** Format button. Render inside React Flow's `<Controls>`. */
export function FormatControls() {
	const { enabled, format, isFormatting } = useCanvasFormat();
	if (!enabled) return null;

	return (
		<ControlButton
			onClick={() => void format()}
			disabled={isFormatting}
			title="Format blocks"
			aria-label="Format blocks"
		>
			<TbLayoutDistributeVertical />
		</ControlButton>
	);
}
