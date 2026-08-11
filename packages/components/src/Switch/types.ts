import type { ReactNode } from "react";
import type { SwitchProps as HeroUISwitchProps } from "@heroui/react";

export interface SwitchProps extends HeroUISwitchProps {
	label?: ReactNode;
	description?: ReactNode;
}
