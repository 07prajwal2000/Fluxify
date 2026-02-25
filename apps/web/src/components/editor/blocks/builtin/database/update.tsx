import React, { useContext } from "react";
import BaseBlock from "../../base";
import BlockHandle from "../../handle";
import { NodeProps } from "@xyflow/react";
import { Position } from "@xyflow/react";
import { TbDatabaseImport, TbInfoCircle } from "react-icons/tb";
import { updateDbBlockSchema } from "@fluxify/blocks";
import z from "zod";
import ConditionsEditor from "@/components/editors/conditionsEditor";
import IntegrationSelector from "@/components/editors/integrationSelector";
import JsTextInput from "@/components/editors/jsTextInput";
import { BlockCanvasContext } from "@/context/blockCanvas";
import {
	Stack,
	Box,
	Text,
	Group,
	Checkbox,
	Alert,
	Button,
	ButtonGroup,
} from "@mantine/core";
import JsEditor from "@/components/editors/jsEditor";
import { OpenJsonEditorButton } from "@/components/editors/jsonEditor";

const Update = (props: NodeProps) => {
	return (
		<BaseBlock
			blockId={props.id}
			nodeProps={props}
			icon={<TbDatabaseImport size={15} />}
			tooltip={props?.data?.label?.toString() ?? ""}
			showOptionsTooltip={!props.dragging}
			optionsTooltip={["delete", "options"]}
			blockName="Update Record(s)"
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

export function UpdateBlockDataSettingsPanel(props: {
	blockId: string;
	blockData: z.infer<typeof updateDbBlockSchema>;
}) {
	const { updateBlockData } = useContext(BlockCanvasContext);

	function onIntegrationSelect(id: string) {
		updateBlockData(props.blockId, {
			connection: id,
		});
	}
	function onTableNameChange(value: string) {
		updateBlockData(props.blockId, {
			tableName: value,
		});
	}
	function onDataChange(value: string) {
		updateBlockData(props.blockId, {
			data: value,
		});
	}
	function onConditionsChange(
		value: { lhs: any; rhs: any; operator: any; chain: any }[],
	) {
		updateBlockData(props.blockId, {
			conditions: value.map((x) => ({
				attribute: x.lhs,
				value: x.rhs,
				operator: x.operator,
				chain: x.chain,
			})),
		});
	}
	function onUseParamChange(value: boolean) {
		updateBlockData(props.blockId, {
			useParam: value,
		});
	}
	function onRawValueChange(value: any) {
		updateBlockData(props.blockId, {
			data: {
				source: "raw",
				value,
			},
		});
	}
	function onJsValueChange(value: string) {
		updateBlockData(props.blockId, {
			data: {
				source: "js",
				value,
			},
		});
	}
	function onDataSourceChange(value: string) {
		updateBlockData(props.blockId, {
			data: {
				source: value,
				value: props.blockData.data.value,
			},
		});
	}
	function onRawDataSourceChange() {
		onDataSourceChange("raw");
	}
	function onJsDataSourceChange() {
		onDataSourceChange("js");
	}
	return (
		<Stack px={"xs"}>
			<IntegrationSelector
				group="database"
				label="Choose Database Connection"
				description="Select the database connection to use for this block"
				selectedIntegration={props.blockData.connection}
				onSelect={onIntegrationSelect}
			/>
			<Group>
				<JsTextInput
					flex={2}
					label="Table Name"
					description="Enter the table name to update or a JS expression that returns the table name"
					value={props.blockData.tableName}
					onValueChange={onTableNameChange}
				/>
				<Checkbox
					flex={1}
					label="Use Parameter"
					color="violet"
					description="Use the data from the previous block as the data to update"
					checked={props.blockData.useParam ?? false}
					onChange={(e) => onUseParamChange(e.currentTarget.checked)}
				/>
			</Group>

			<Stack gap={2}>
				<Text>Edit Condition(s)</Text>
				<Text size="xs" c={"gray"}>
					The conditions to use to update the record(s)
				</Text>
				<Box my={2} />
				<ConditionsEditor
					conditions={
						props.blockData.conditions.map((condition) => ({
							...condition,
							lhs: condition.attribute,
							rhs: condition.value,
						})) ?? []
					}
					ignoreOperators={["is_empty", "is_not_empty"]}
					onChange={onConditionsChange}
					disableJsConditions
				/>
			</Stack>
			{!props.blockData.useParam && (
				<Stack>
					<Text>Data to Update</Text>
					<ButtonGroup>
						<Button
							fullWidth
							variant={
								props.blockData.data.source === "raw" ? "filled" : "outline"
							}
							color="violet"
							onClick={onRawDataSourceChange}
						>
							Raw
						</Button>
						<Button
							fullWidth
							variant={
								props.blockData.data.source === "js" ? "filled" : "outline"
							}
							color="violet"
							onClick={onJsDataSourceChange}
						>
							JS
						</Button>
					</ButtonGroup>
				</Stack>
			)}
			{props.blockData.data.source === "raw" && !props.blockData.useParam && (
				<OpenJsonEditorButton
					variant="outline"
					label="Edit JSON Data"
					onSave={onRawValueChange}
					rootValueType="object"
					defaultValue={props.blockData.data.value}
				/>
			)}
			{props.blockData.data.source === "js" && !props.blockData.useParam && (
				<>
					<Alert p={"xs"} icon={<TbInfoCircle size={20} />}>
						<Text size="sm">
							Return a single object to update into the database
						</Text>
					</Alert>
					<Box my={2} onKeyDown={(e) => e.stopPropagation()}>
						<JsEditor
							height={200}
							defaultValue={
								typeof props.blockData.data.value === "string"
									? props.blockData.data.value
									: ""
							}
							onChange={onJsValueChange}
						/>
					</Box>
				</>
			)}
		</Stack>
	);
}

export default Update;
