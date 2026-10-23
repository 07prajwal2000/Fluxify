import { useState } from "react";
import { TbBolt, TbPackage } from "react-icons/tb";
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

/**
 * A trigger kind's icon, or the bolt the Triggers page uses. A manifest can
 * name an icon the portal cannot load, so a failed image falls back too.
 */
export function PluginTriggerIcon({ icon, size = 20 }: { icon?: string; size?: number }) {
	const [broken, setBroken] = useState(false);
	if (!icon || broken) {
		return (
			<span className="flex shrink-0" data-testid="plugin-trigger-icon-default">
				<TbBolt size={size} />
			</span>
		);
	}
	return (
		<img
			src={icon}
			alt=""
			width={size}
			height={size}
			data-testid="plugin-trigger-icon"
			className="shrink-0 rounded object-contain"
			onError={() => setBroken(true)}
		/>
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
