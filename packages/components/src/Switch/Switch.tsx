import { Switch as HeroUISwitch, Description } from "@heroui/react";
import type { SwitchProps } from "./types";

export function Switch({
	isSelected,
	defaultSelected,
	label,
	description,
	...props
}: SwitchProps) {
	return (
		<HeroUISwitch
			isSelected={isSelected}
			defaultSelected={defaultSelected}
			{...props}
		>
			<HeroUISwitch.Content>
				<HeroUISwitch.Control>
					<HeroUISwitch.Thumb>
						<HeroUISwitch.Icon />
					</HeroUISwitch.Thumb>
				</HeroUISwitch.Control>
				{label && (
					<span className="text-sm font-medium text-muted-foreground ml-2">
						{label}
					</span>
				)}
				{description && <Description>{description}</Description>}
			</HeroUISwitch.Content>
		</HeroUISwitch>
	);
}

Switch.displayName = "Switch";
