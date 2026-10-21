import { TbPackage } from "react-icons/tb";
import { CustomBlockIcon, type IconValue } from "@/components/customBlocks/IconPicker";
import type { Plugin, PluginManifest } from "@/services/plugins";

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

/** what a plugin says about itself in its manifest: its icon (a data URL) and description */
export const pluginMeta = (plugin: Plugin) => {
	const manifest = plugin.manifest as Partial<PluginManifest>;
	return { icon: manifest.icon, description: manifest.description };
};

/** the plugin's own icon, or the default package icon */
export function PluginIcon({ plugin, size = 20 }: { plugin: Plugin; size?: number }) {
	const { icon } = pluginMeta(plugin);
	return (
		<span className="flex shrink-0 text-muted" data-testid="plugin-icon">
			{icon ? (
				<CustomBlockIcon icon="custom" iconUrl={icon} size={size} />
			) : (
				<TbPackage size={size} />
			)}
		</span>
	);
}
