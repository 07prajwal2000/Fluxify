import { integrationIcons } from "@fluxify/components";
import { useState } from "react";
import { TbPlug } from "react-icons/tb";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { GROUP_DETAILS } from "./groupDetails";

/**
 * An integration variant's icon: the built-in one, else a plugin's own (the
 * data URL its variants entry carries), else its group's, else a plug. A
 * plugin's image that fails to load falls back to the group's too.
 */
export function IntegrationVariantIcon({
	variant,
	group,
	icon,
	size = 16,
}: {
	variant: string;
	group?: string;
	/** the plugin variant's icon from the variants catalog: `catalog.iconOf(variant, group)` */
	icon?: string;
	size?: number;
}) {
	const [failed, setFailed] = useState<string>();
	const builtIn = integrationIcons[variant];
	if (builtIn) return <>{builtIn}</>;
	if (icon && icon !== failed)
		return (
			<CustomBlockIcon icon="custom" iconUrl={icon} size={size} onError={() => setFailed(icon)} />
		);
	return <>{(group && GROUP_DETAILS[group]?.icon) ?? <TbPlug size={size} />}</>;
}
