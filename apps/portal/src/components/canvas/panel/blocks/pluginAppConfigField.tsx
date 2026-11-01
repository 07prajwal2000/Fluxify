import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { AppConfigSelector } from "@/components/integrations/AppConfigSelector";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { useCustomBlockParamConfigs } from "../fields";

type Props = {
	blockId: string;
	data: Record<string, unknown>;
	name: string;
	label?: string;
	hint?: string;
};

/**
 * A plugin block's `appconfig` param, as the trigger and integration forms draw
 * it: a text box plus the key picker; a picked key is stored as `cfg:<KEY>`.
 * Inside a custom block it also offers that block's own inputs as `param:<name>`.
 */
export function PluginAppConfigParam({ blockId, data, name, label, hint }: Props) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const route = useParams({ strict: false }) as { projectId?: string; blockId?: string };
	const projectId = route?.projectId ?? "";
	const extraItems = useCustomBlockParamConfigs(projectId, route?.blockId);
	return (
		<AppConfigSelector
			projectId={projectId}
			label={label}
			description={hint}
			value={typeof data[name] === "string" ? (data[name] as string) : ""}
			isDisabled={!editable}
			extraItems={extraItems}
			onChange={(next) => updateNodeData(blockId, { [name]: next })}
		/>
	);
}
