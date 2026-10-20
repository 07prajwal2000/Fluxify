import { CustomBlockIcon, type IconValue } from "@/components/customBlocks/IconPicker";
import type { PluginManifest } from "@/services/plugins";

/** a plugin block's icon as the custom block icon takes it: its data URL, or the default when it has none */
export const pluginBlockIcon = (block: PluginManifest["blocks"][string]): IconValue =>
	block.icon ? { icon: "custom", iconUrl: block.icon } : {};

export function PluginBlockIcon({
	block,
	size = 20,
}: {
	block: PluginManifest["blocks"][string];
	size?: number;
}) {
	return (
		<span className="mt-0.5 shrink-0 text-muted">
			<CustomBlockIcon {...pluginBlockIcon(block)} size={size} />
		</span>
	);
}
