import { Handle, Position, useNodeConnections } from "@xyflow/react";
import type React from "react";

type Props = {
	style?: React.CSSProperties;
	position?: Position;
	blockId: string;
	type: "source" | "target";
	handleVariant?: string;
	color?: string;
};

// Ported verbatim from web: handle id is `${blockId}-${variant ?? type}`, which
// is exactly what the saved edges reference.
export function BlockHandle(props: Props) {
	const handleId = `${props.blockId}-${props.handleVariant ?? props.type}`;
	const isVertical =
		props.position === Position.Top || props.position === Position.Bottom;
	const isTarget = props.type === "target";
	const width = isVertical ? "15px" : "6px";
	const height = isVertical ? "6px" : "15px";
	const connection = useNodeConnections({ handleId, handleType: props.type });

	return (
		<Handle
			id={handleId}
			position={props.position || Position.Right}
			style={{
				...props.style,
				borderRadius: isTarget ? "0" : "50%",
				width: isTarget ? width : "10px",
				height: isTarget ? height : "10px",
				backgroundColor: props.color || "var(--color-accent)",
			}}
			type={props.type}
			isConnectable={isTarget || connection.length === 0}
		/>
	);
}
