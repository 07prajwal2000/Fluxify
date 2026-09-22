import { Tabs } from "@fluxify/components";
import { Children, isValidElement, type ReactNode, useState } from "react";
import { TbAlertCircle, TbAlertTriangle, TbInfoCircle } from "react-icons/tb";
import { blockLabels } from "../blocks/blockLabels";
import { useBlockDiagnostics } from "../diagnostics";
import { diagnosticSourceLabel } from "../diagnostics/types";
import type { BlockNode } from "../types";
import { BlockDescriptionField, BlockNameInput } from "./BlockIdentityFields";
import { SaveOutputField, savesOutput } from "./SaveOutputField";

/** Every block has this tab; block tabs are appended after it. */
export const GENERAL_TAB = "General";
export const DIAGNOSTICS_TAB = "Diagnostics";

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
	initialTab?: string | null;
	/** Changes on every open, so reopening the same tab still selects it. */
	openSeq?: number;
	/** `BlockSettings.TabHead` elements contributed by the block. */
	children?: ReactNode;
};

/**
 * Tabbed settings for the open block. General (name + description) is always
 * there and always first; a block adds its own tabs, or appends to General by
 * declaring a tab with that name.
 */
export function BlockSettings({ block, initialTab, openSeq, children }: BlockSettingsProps) {
	const { generalExtras, blockTabs } = splitTabs(children);
	const { definition } = blockLabels(block.type ?? "unknown", block.data);
	const { forBlock } = useBlockDiagnostics();
	const diagnostics = forBlock(block.id);
	const hasDiagnostics = diagnostics.length > 0;

	// the picked tab survives edits; only a new open resets it
	const request = `${block.id}|${initialTab ?? ""}|${openSeq ?? 0}`;
	const [picked, setPicked] = useState({ request, tab: initialTab ?? GENERAL_TAB });
	const wanted = picked.request === request ? picked.tab : (initialTab ?? GENERAL_TAB);
	// a tab can vanish (last issue fixed, method without a body): fall back to
	// General for good, so the tab coming back later doesn't pull focus to it
	const exists =
		wanted === GENERAL_TAB ||
		(wanted === DIAGNOSTICS_TAB && hasDiagnostics) ||
		blockTabs.some((t) => t.props.name === wanted);
	const selectedTab = exists ? wanted : GENERAL_TAB;
	if (picked.request !== request || picked.tab !== selectedTab) {
		setPicked({ request, tab: selectedTab });
	}

	return (
		<Tabs
			selectedKey={selectedTab}
			onSelectionChange={(key) => setPicked({ request, tab: String(key) })}
			variant="secondary"
			className="fx-panel__tabs"
		>
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
					{hasDiagnostics && (
						<Tabs.Tab id={DIAGNOSTICS_TAB}>
							<span className="flex items-center gap-1.5">
								{DIAGNOSTICS_TAB}
								<span className="rounded-full bg-danger/10 px-1.5 py-0.2 text-[10px] font-semibold text-danger">
									{diagnostics.length}
								</span>
							</span>
							<Tabs.Indicator />
						</Tabs.Tab>
					)}
				</Tabs.List>
			</Tabs.ListContainer>

			<Tabs.Panel id={GENERAL_TAB} className="fx-panel__tab-panel">
				<BlockNameInput
					key={`${block.id}-name`}
					blockId={block.id}
					data={block.data}
					placeholder={definition.name}
				/>
				<BlockDescriptionField
					key={`${block.id}-description`}
					blockId={block.id}
					data={block.data}
					placeholder={definition.description}
				/>
				{generalExtras.length > 0 && <hr className="fx-panel__divider" />}
				{generalExtras}
				{savesOutput(block.type, block.data) && (
					<>
						<hr className="fx-panel__divider" />
						<SaveOutputField block={block} />
					</>
				)}
			</Tabs.Panel>
			{blockTabs.map((tab) => (
				<Tabs.Panel key={tab.props.name} id={tab.props.name} className="fx-panel__tab-panel">
					{tab.props.children}
				</Tabs.Panel>
			))}
			{hasDiagnostics && (
				<Tabs.Panel id={DIAGNOSTICS_TAB} className="fx-panel__tab-panel">
					<div className="flex flex-col gap-2 pt-1">
						{diagnostics.map((diag, index) => (
							<button
								type="button"
								key={`${diag.source}-${index}`}
								disabled={!diag.tab}
								onClick={() => diag.tab && setPicked({ request, tab: diag.tab })}
								className="flex items-start gap-2.5 rounded-md border border-border bg-surface-secondary/40 p-2.5 text-left text-xs enabled:hover:border-border-hover"
							>
								<span className="mt-0.5 shrink-0">
									{diag.severity === "error" ? (
										<TbAlertCircle className="text-danger" size={16} />
									) : diag.severity === "warning" ? (
										<TbAlertTriangle className="text-warning" size={16} />
									) : (
										<TbInfoCircle className="text-sky-500" size={16} />
									)}
								</span>
								<div className="flex min-w-0 flex-1 flex-col gap-1">
									<p className="font-normal leading-relaxed text-foreground">{diag.message}</p>
									<span className="self-start rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">
										{diagnosticSourceLabel(diag.source)}
										{diag.tab && ` · opens ${diag.tab}`}
									</span>
								</div>
							</button>
						))}
					</div>
				</Tabs.Panel>
			)}
		</Tabs>
	);
}

BlockSettings.TabHead = TabHead;
