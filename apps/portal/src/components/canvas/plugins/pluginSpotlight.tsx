import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { pluginBlockIcon } from "@/components/settings/plugins/pluginBlockIcon";
import type { BlockType } from "../blocks";
import type { SpotlightCommand } from "../spotlight/types";
import { byDeprecationThenLabel, type PluginBlockDef } from "./pluginBlocks";

/** "Add Block" for each plugin block that can be added, deprecated ones last; found by label or by path. */
export const pluginBlockCommands = (
	defs: PluginBlockDef[],
	onAddBlock: (type: BlockType) => void,
	onClose: () => void,
): SpotlightCommand[] =>
	defs
		.filter((def) => def.loads)
		.sort(byDeprecationThenLabel)
		.map((def) => ({
			id: `plugin-block-${def.type}`,
			title: `Add Block: ${def.label}`,
			subtitle: `Plugin • ${def.plugin}`,
			description: def.deprecated ? `Deprecated: ${def.deprecated}` : (def.description ?? def.type),
			category: "Blocks",
			keywords: ["add", "block", "plugin", def.type, def.label],
			icon: <CustomBlockIcon {...pluginBlockIcon(def.entry)} />,
			onSelect: () => {
				onClose();
				onAddBlock(def.type as BlockType);
			},
		}));
