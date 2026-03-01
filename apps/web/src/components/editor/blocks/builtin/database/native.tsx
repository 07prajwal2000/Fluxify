import BaseBlock from "../../base";
import BlockHandle from "../../handle";
import { NodeProps } from "@xyflow/react";
import { Position } from "@xyflow/react";
import { TbDatabaseEdit } from "react-icons/tb";
import { useContext } from "react";
import { BlockCanvasContext } from "@/context/blockCanvas";
import IntegrationSelector from "@/components/editors/integrationSelector";
import { Alert, Stack } from "@mantine/core";
import { z } from "zod";
import { nativeDbBlockSchema } from "@fluxify/blocks";
import JsEditor from "@/components/editors/jsEditor";
const Native = (props: NodeProps) => {
	return (
		<BaseBlock
			blockId={props.id}
			nodeProps={props}
			icon={<TbDatabaseEdit size={15} />}
			tooltip={props?.data?.label?.toString() ?? ""}
			showOptionsTooltip={!props.dragging}
			optionsTooltip={["delete", "options"]}
			blockName="Native Database"
			labelPlacement="left"
		>
			<BlockHandle
				type="source"
				blockId={`${props.id}`}
				position={Position.Bottom}
			/>
			<BlockHandle
				type="target"
				blockId={`${props.id}`}
				position={Position.Top}
			/>
		</BaseBlock>
	);
};

export function NativeBlockHelpPanel(props: {
	blockId: string;
	blockData: z.infer<typeof nativeDbBlockSchema>;
}) {
	return (
		<Alert p={"xs"} color="green">
			Here you have access to <code>dbQuery</code> async function to perform
			database operations. The implementation depends on the selected database
			connection. Please refer to the{" "}
			<a href="https://docs.fluxify.rest/blocks/db-native/" target="_blank">
				documentation.
			</a>
		</Alert>
	);
}

export const NativeBlockDataSettingsPanel = (props: {
	blockData: z.infer<typeof nativeDbBlockSchema>;
	blockId: string;
}) => {
	const { updateBlockData } = useContext(BlockCanvasContext);

	function onIntegrationSelect(id: string) {
		updateBlockData(props.blockId, {
			connection: id,
		});
	}

	function onJsChange(value: string) {
		updateBlockData(props.blockId, {
			js: value,
		});
	}

	return (
		<Stack px={"xs"} onKeyDown={(e) => e.stopPropagation()}>
			<IntegrationSelector
				group="database"
				label="Choose Database Connection"
				description="Select the database connection to perform a native database operation"
				selectedIntegration={props.blockData.connection}
				onSelect={onIntegrationSelect}
			/>
			<JsEditor
				showLineNumbers={false}
				value={props.blockData.js}
				onChange={onJsChange}
			/>
		</Stack>
	);
};

export default Native;
