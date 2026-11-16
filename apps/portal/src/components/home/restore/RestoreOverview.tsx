import { Button } from "@fluxify/components";
import { useState } from "react";
import { MarkdownViewer } from "@/components/ai/MarkdownViewer";
import { Section } from "@/components/common/Section";
import { labelOf, MODE_COPY } from "@/components/settings/backup/labels";
import type { ArchiveSummary } from "@/services/projects";
import { iconOf } from "./SectionBrowser";

/** past this the README starts folded */
const LONG_README = 1500;

/** The first page: where the file comes from, what it holds, what to know, and its README. */
export function RestoreOverview({
	summary,
	onOpenSection,
}: {
	summary: ArchiveSummary;
	onOpenSection: (section: string) => void;
}) {
	const facts = [
		["Source project", `${summary.source.name} (${summary.source.slug})`],
		["Made with release", summary.release],
		["Made on", new Date(summary.createdAt).toLocaleString()],
		["Kind", MODE_COPY[summary.mode].title],
	];
	return (
		<div className="h-full overflow-y-auto p-6">
			<div className="flex max-w-4xl flex-col gap-6">
				<Section title="About this file" description={MODE_COPY[summary.mode].body}>
					<dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
						{facts.map(([label, value]) => (
							<div key={label} className="contents">
								<dt className="text-muted">{label}</dt>
								<dd className="text-foreground">{value}</dd>
							</div>
						))}
					</dl>
				</Section>

				<Section
					title="What it holds"
					description="Open a section to look through it. Nothing can be changed here."
				>
					<div className="grid grid-cols-2 gap-2 md:grid-cols-3">
						{summary.preview.map((p) => {
							const Icon = iconOf(p.section);
							return (
								<button
									key={p.section}
									type="button"
									onClick={() => onOpenSection(p.section)}
									className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition-colors hover:bg-surface-secondary"
								>
									<Icon size={18} className="text-muted" />
									<span className="min-w-0 flex-1 truncate text-sm text-foreground">
										{labelOf(p.section)}
									</span>
									<span className="text-sm text-muted">{p.items.length}</span>
								</button>
							);
						})}
					</div>
				</Section>

				{summary.warnings.length > 0 && (
					<Section title="Before you restore" description="None of these stop the restore.">
						<ul className="flex flex-col gap-2">
							{summary.warnings.map((w) => (
								<li
									key={`${w.section}:${w.message}`}
									className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-sm text-foreground"
								>
									<span className="mr-2 text-xs font-medium text-warning">
										{labelOf(w.section)}
									</span>
									{w.message}
								</li>
							))}
						</ul>
					</Section>
				)}

				{summary.readme && <Readme text={summary.readme} />}
			</div>
		</div>
	);
}

/** the author's note: untrusted, so Markdown only (no raw HTML), links open in a new tab */
function Readme({ text }: { text: string }) {
	const long = text.length > LONG_README;
	const [open, setOpen] = useState(!long);
	return (
		<section aria-label="README" className="rounded-lg border border-border px-4 pt-4">
			<p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">README</p>
			<div className={open ? undefined : "max-h-64 overflow-hidden"}>
				<MarkdownViewer content={text} />
			</div>
			{long && (
				<Button size="sm" variant="ghost" className="mb-2" onPress={() => setOpen(!open)}>
					{open ? "Show less" : "Show the whole README"}
				</Button>
			)}
		</section>
	);
}
