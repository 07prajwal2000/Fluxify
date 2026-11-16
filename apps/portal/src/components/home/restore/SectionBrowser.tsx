import { cn, Tabs } from "@fluxify/components";
import { lazy, Suspense, useMemo, useState } from "react";
import type { IconType } from "react-icons";
import {
	TbAdjustments,
	TbAlertTriangle,
	TbArrowsSplit,
	TbBook,
	TbBox,
	TbChevronDown,
	TbClock,
	TbKey,
	TbPackage,
	TbPlug,
	TbPlugConnected,
	TbPuzzle,
	TbRoute,
	TbStack2,
} from "react-icons/tb";
import { labelOf, SECTION_LABELS } from "@/components/settings/backup/labels";
import { previewCanvas } from "@/components/transfer/resources";
import type { ArchiveSummary } from "@/services/projects";

// ReactFlow loads only when a canvas is on screen
const CanvasDiffGraph = lazy(() => import("@/components/ai/preview/CanvasDiffGraph"));

type SectionPreview = ArchiveSummary["preview"][number];
type Item = SectionPreview["items"][number];

const ICONS: Record<string, IconType> = {
	routes: TbRoute,
	workflows: TbArrowsSplit,
	triggers: TbClock,
	customBlocks: TbPuzzle,
	middlewares: TbStack2,
	integrations: TbPlugConnected,
	appConfig: TbKey,
	projectSettings: TbAdjustments,
	projectDependencies: TbPackage,
	plugins: TbPlug,
	knowledgeSources: TbBook,
};
export const iconOf = (section: string): IconType => ICONS[section] ?? TbBox;

/** One section of the file: its resources on the left, the picked one read only on the right. */
export function SectionBrowser({
	section,
	warnings,
}: {
	section: SectionPreview;
	warnings: ArchiveSummary["warnings"];
}) {
	const [picked, setPicked] = useState(0);
	const item = section.items[picked];
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="shrink-0 border-b border-border px-5 py-3">
				<h3 className="text-sm font-semibold text-foreground">{labelOf(section.section)}</h3>
				<p className="text-xs text-muted">
					{SECTION_LABELS[section.section]?.description ?? ""} {section.items.length} in this file.
				</p>
				<SectionWarnings warnings={warnings} />
			</div>
			{section.items.length === 0 ? (
				<p className="p-6 text-sm text-muted">Nothing in this section.</p>
			) : (
				<div className="flex min-h-0 flex-1">
					<ul
						aria-label={`${labelOf(section.section)} in the file`}
						className="w-72 shrink-0 overflow-y-auto border-r border-border p-2"
					>
						{section.items.map((it, i) => (
							<li key={`${it.name}:${i}`}>
								<button
									type="button"
									aria-current={i === picked ? "true" : undefined}
									onClick={() => setPicked(i)}
									className={cn(
										"w-full rounded-lg px-3 py-2 text-left transition-colors",
										i === picked ? "bg-surface-secondary" : "hover:bg-surface-secondary",
									)}
								>
									<span className="block truncate text-sm text-foreground">{it.name}</span>
									{it.summary && (
										<span className="block truncate font-mono text-xs text-muted">
											{it.summary}
										</span>
									)}
								</button>
							</li>
						))}
					</ul>
					{item && <ItemPreview key={`${section.section}:${picked}`} item={item} />}
				</div>
			)}
		</div>
	);
}

/** one warning shows as is; several fold into a line that opens, so the list stays in view */
function SectionWarnings({ warnings }: { warnings: ArchiveSummary["warnings"] }) {
	const [open, setOpen] = useState(warnings.length === 1);
	if (warnings.length === 0) return null;
	return (
		<div className="mt-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-foreground">
			{warnings.length > 1 && (
				<button
					type="button"
					aria-expanded={open}
					onClick={() => setOpen(!open)}
					className="flex w-full items-center gap-2 text-left font-medium"
				>
					<TbAlertTriangle size={14} className="shrink-0 text-warning" />
					{warnings.length} things to know before restoring
					<TbChevronDown
						size={14}
						className={cn("ml-auto transition-transform", open && "rotate-180")}
					/>
				</button>
			)}
			{open && (
				<ul
					className={cn(
						"flex max-h-32 flex-col gap-1.5 overflow-y-auto",
						warnings.length > 1 && "mt-2",
					)}
				>
					{warnings.map((w) => (
						<li key={w.message} className="flex gap-2">
							{warnings.length === 1 && (
								<TbAlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
							)}
							{w.message}
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

type WithCanvas = Item & Required<Pick<Item, "canvas">>;

/** the picked resource: its canvas filling the panel when it has one, its details a tab away */
function ItemPreview({ item }: { item: Item }) {
	const [tab, setTab] = useState(item.canvas ? "canvas" : "details");
	return (
		<section
			aria-label={`Preview of ${item.name}`}
			className="flex min-h-0 min-w-0 flex-1 flex-col"
		>
			<div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-3">
				<div className="min-w-0">
					<h4 className="truncate text-sm font-semibold text-foreground">{item.name}</h4>
					{item.summary && <p className="truncate font-mono text-xs text-muted">{item.summary}</p>}
				</div>
				{item.canvas && (
					<Tabs
						selectedKey={tab}
						onSelectionChange={(key) => setTab(String(key))}
						className="ml-auto"
					>
						<Tabs.List aria-label="Preview">
							<Tabs.Tab id="canvas">Canvas</Tabs.Tab>
							<Tabs.Tab id="details">Details</Tabs.Tab>
						</Tabs.List>
					</Tabs>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto p-5">
				{tab === "canvas" && item.canvas ? (
					<CanvasPreview item={item as WithCanvas} />
				) : (
					<Details item={item} />
				)}
			</div>
		</section>
	);
}

function Details({ item }: { item: Item }) {
	const details = Object.entries(item.details ?? {}).filter(([, v]) => v !== null && v !== "");
	if (details.length === 0) return <p className="text-sm text-muted">Nothing more to show.</p>;
	return (
		<dl className="grid max-w-3xl grid-cols-[max-content_1fr] gap-x-8 gap-y-3 text-sm">
			{details.map(([label, value]) => (
				<div key={label} className="contents">
					<dt className="text-muted">{label}</dt>
					<dd className="min-w-0 break-words text-foreground">
						{typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)}
					</dd>
				</div>
			))}
		</dl>
	);
}

/** read only: clicking a block opens its settings, locked as on any read-only canvas */
function CanvasPreview({ item }: { item: WithCanvas }) {
	const diff = useMemo(() => previewCanvas(item), [item]);
	const [selected, setSelected] = useState<string>();
	if (item.canvas.blocks.length === 0)
		return <p className="text-sm text-muted">The canvas is empty.</p>;
	return (
		<div className="flex h-full min-h-[22rem] flex-col gap-2">
			<p className="text-xs text-muted">
				The working canvas, read only. Click a block to see its settings.
			</p>
			<Suspense fallback={<div className="flex-1 animate-pulse rounded-lg bg-surface-secondary" />}>
				<CanvasDiffGraph
					diff={diff}
					selected={selected}
					onSelect={setSelected}
					panel
					heightClass="flex-1"
				/>
			</Suspense>
		</div>
	);
}
