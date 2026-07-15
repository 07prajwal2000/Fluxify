import {
	Stack,
	Checkbox,
	Select,
	Text,
	Center,
	Divider,
	Button,
	Group,
} from "@mantine/core";
import React from "react";
import JsTextInput from "../../../editors/jsTextInput";
import ArrayEditor from "../../../editors/arrayEditor";
import IntegrationSelector from "../../../editors/integrationSelector";
import { BlockCanvasContext } from "@/context/blockCanvas";
import { useFlowEditorContext } from "../../flowEditor/flowEditorContext";
import { TbExternalLink } from "react-icons/tb";

type Props = {
	blockId: string;
	blockData: any;
	customBlock: any;
};

export const CustomBlockSettingsPanel = ({
	blockId,
	blockData,
	customBlock,
}: Props) => {
	const { updateBlockData } = React.useContext(BlockCanvasContext);
	const { projectId } = useFlowEditorContext();

	function onDataChange(key: string, value: any) {
		updateBlockData(blockId, { [key]: value });
	}

	return (
		<Stack gap={"md"}>
			<Group justify="space-between" align="center">
				<Text size="lg" fw={500}>
					Parameters
				</Text>
				{customBlock.sourceType === "user-defined" && (
					<Button
						component="a"
						href={`/_/admin/ui/${projectId}/custom-blocks/edit/${customBlock.id}`}
						target="_blank"
						variant="light"
						color="violet"
						size="xs"
						rightSection={<TbExternalLink size={14} />}
					>
						Edit Implementation
					</Button>
				)}
			</Group>
			<Divider />
			{(customBlock.inputParams ?? []).map((param: any) => {
				const value = blockData[param.name];

				switch (param.type) {
					case "text_input":
						return (
							<JsTextInput
								key={param.name}
								label={param.label}
								value={value ?? ""}
								// TODO: this isn't working properly.
								onValueChange={(val) => onDataChange(param.name, val)}
								onClear={() => onDataChange(param.name, "")}
							/>
						);
					case "checkbox":
						return (
							<Checkbox
								key={param.name}
								label={param.label}
								checked={value ?? false}
								onChange={(e) =>
									onDataChange(param.name, e.currentTarget.checked)
								}
							/>
						);
					case "dropdown":
						return (
							<Select
								key={param.name}
								label={param.label}
								data={param.options || []}
								value={value ?? ""}
								onChange={(val) => onDataChange(param.name, val)}
							/>
						);
					case "array_editor":
						return (
							<Stack key={param.name} gap={4}>
								<Text size="sm" fw={500}>
									{param.label}
								</Text>
								<ArrayEditor
									array={value || []}
									onAdd={() => onDataChange(param.name, [...(value || []), ""])}
									onRemove={(idx) => {
										const newArr = [...(value || [])];
										newArr.splice(idx, 1);
										onDataChange(param.name, newArr);
									}}
									onValueChange={(idx, val) => {
										const newArr = [...(value || [])];
										newArr[idx] = val;
										onDataChange(param.name, newArr);
									}}
									showAddButton
								/>
							</Stack>
						);
					case "integration_selector":
						return (
							<IntegrationSelector
								key={param.name}
								label={param.label}
								group={param.group}
								tags={param.tags || []}
								selectedIntegration={value || ""}
								onSelect={(id) => onDataChange(param.name, id)}
							/>
						);
					default:
						return null;
				}
			})}
			{!customBlock.inputParams ||
				(customBlock.inputParams.length === 0 && (
					<Center h={100}>
						<Text c="dimmed">This block has no input parameters.</Text>
					</Center>
				))}
		</Stack>
	);
};
