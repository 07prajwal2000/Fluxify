import type { ReactNode } from "react";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import { getVarSettings } from "./blocks/GetVarSettings";
import { ifSettings } from "./blocks/IfSettings";
import { jsRunnerSettings } from "./blocks/JsRunnerSettings";
import { responseSettings } from "./blocks/ResponseSettings";
import { setVarSettings } from "./blocks/SetVarSettings";
import { transformerSettings } from "./blocks/TransformerSettings";
import type { BlockNode } from "../types";

/**
 * Extra settings tabs per block type. A block returns
 * `BlockSettings.TabHead` elements; everything else (the General tab, the tab
 * chrome) comes from `BlockSettings`. Blocks missing here get General only.
 */
export type BlockTabs = (block: BlockNode) => ReactNode;

export const BLOCK_SETTINGS_TABS: Record<string, BlockTabs> = {
	[BLOCK_TYPES.if]: ifSettings,
	[BLOCK_TYPES.response]: responseSettings,
	[BLOCK_TYPES.getvar]: getVarSettings,
	[BLOCK_TYPES.setvar]: setVarSettings,
	[BLOCK_TYPES.transformer]: transformerSettings,
	[BLOCK_TYPES.jsrunner]: jsRunnerSettings,
};

export function blockSettingsTabs(type: string | undefined): BlockTabs | undefined {
	return type ? BLOCK_SETTINGS_TABS[type] : undefined;
}


