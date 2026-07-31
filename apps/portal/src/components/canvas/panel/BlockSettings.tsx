import { Children, isValidElement, type ReactNode } from "react";
import { Tabs } from "@fluxify/components";
import {
	BlockDescriptionField,
	BlockNameInput,
} from "./BlockIdentityFields";
import { blockLabels } from "../blocks/blockLabels";
import type { BlockNode } from "../types";

/** Every block has this tab; block tabs are appended after it. */
export const GENERAL_TAB = "General";

export type BlockSettingsTabProps = {
	/** Tab label, and its id. Use `General` to extend the built-in tab. */
	name: string;
	title?: ReactNode;
	children?: ReactNode;
};

/**
 * Declares one tab. Renders nothing itself — `BlockSettings` reads the element
 * and renders `children` inside the tab panel, so a block's settings read as
 * markup:
 *
 * ```tsx
 * <BlockSettings block={block}>
 *   <BlockSettings.TabHead name="Request">…</BlockSettings.TabHead>
 * </BlockSettings>
 * ```
 */
function TabHead(_props: BlockSettingsTabProps): ReactNode {
	return null;
}

/**
 * Splits declared tabs into what goes under General and what becomes its own
 * tab. Anything that is not a `TabHead` is ignored — tabs are the only way in.
 */
export function splitTabs(children: ReactNode) {
	const heads = Children.toArray(children).filter(
		(child) => isValidElement(child) && child.type === TabHead,
	) as React.ReactElement<BlockSettingsTabProps>[];

	return {
		generalExtras: heads
			.filter((head) => head.props.name === GENERAL_TAB)
			.map((head) => head.props.children),
		blockTabs: heads.filter((head) => head.props.name !== GENERAL_TAB),
	};
}

export type BlockSettingsProps = {
	block: BlockNode;
	/** `BlockSettings.TabHead` elements contributed by the block. */
	children?: ReactNode;
};

/**
 * Tabbed settings for the open block. General (name + description) is always
 * there and always first; a block adds its own tabs, or appends to General by
 * declaring a tab with that name.
 */
export function BlockSettings({ block, children }: BlockSettingsProps) {
	const { generalExtras, blockTabs } = splitTabs(children);
	const { definition } = blockLabels(block.type ?? "unknown", block.data);

	return (
		// Remount per block: a block without the tab that was open must not keep it.
		<Tabs key={block.id} variant="secondary" className="fx-panel__tabs">
			{/* ListContainer is what the secondary variant styles hang off, and the
			    indicator is the underline itself — neither is implicit. The
			    indicator goes inside a tab: its shared-element scope is the tab
			    collection, and it positions itself against the tab it is in. */}
			<Tabs.ListContainer>
				<Tabs.List>
					<Tabs.Tab id={GENERAL_TAB}>
						{GENERAL_TAB}
						<Tabs.Indicator />
					</Tabs.Tab>
					{blockTabs.map((tab) => (
						<Tabs.Tab key={tab.props.name} id={tab.props.name}>
							{tab.props.title ?? tab.props.name}
							<Tabs.Indicator />
						</Tabs.Tab>
					))}
				</Tabs.List>
			</Tabs.ListContainer>

			<Tabs.Panel id={GENERAL_TAB} className="fx-panel__tab-panel">
				<BlockNameInput
					blockId={block.id}
					data={block.data}
					placeholder={definition.name}
				/>
				<BlockDescriptionField
					blockId={block.id}
					data={block.data}
					placeholder={definition.description}
				/>
				{generalExtras.length > 0 && <hr className="fx-panel__divider" />}
				{generalExtras}
			</Tabs.Panel>
			{blockTabs.map((tab) => (
				<Tabs.Panel
					key={tab.props.name}
					id={tab.props.name}
					className="fx-panel__tab-panel"
				>
					{tab.props.children}
				</Tabs.Panel>
			))}
		</Tabs>
	);
}

BlockSettings.TabHead = TabHead;
