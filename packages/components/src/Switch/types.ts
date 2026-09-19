import type { SwitchProps as HeroUISwitchProps } from "@heroui/react";
import type { ReactNode } from "react";

export interface SwitchProps extends HeroUISwitchProps {
	label?: ReactNode;
	description?: ReactNode;
}
