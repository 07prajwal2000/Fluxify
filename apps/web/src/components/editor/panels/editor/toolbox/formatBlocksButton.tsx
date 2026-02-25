import { useCanvasActionsStore } from "@/store/canvas";
import { useEditorChangeTrackerStore } from "@/store/editor";
import { ActionIcon, Tooltip } from "@mantine/core";
import React from "react";
import { MdOutlineCleaningServices } from "react-icons/md";

const FormatBlocksButton = () => {
	const { formatBlocks } = useCanvasActionsStore().blocks;
	const { add } = useEditorChangeTrackerStore();

	async function onClick() {
		const ids = await formatBlocks();
		for (const id of ids) {
			add(id, "block");
		}
	}

	return (
		<Tooltip
			onClick={onClick}
			label={"Format Blocks"}
			withArrow
			arrowSize={8}
			bg={"dark"}
		>
			<ActionIcon size={"lg"} variant="subtle" color={"dark"}>
				<MdOutlineCleaningServices size={18} />
			</ActionIcon>
		</Tooltip>
	);
};

export default FormatBlocksButton;
