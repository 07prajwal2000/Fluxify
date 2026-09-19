import type { ReactNode } from "react";

export type SpotlightCategory = "Actions" | "Navigation" | "Blocks" | "Resources" | "Help";

export type SpotlightCommand = {
	id: string;
	title: string;
	subtitle?: string;
	description?: string;
	category: SpotlightCategory;
	keywords?: string[];
	icon?: ReactNode;
	shortcut?: string;
	disabled?: boolean;
	disabledReason?: string;
	onSelect: () => void;
};
