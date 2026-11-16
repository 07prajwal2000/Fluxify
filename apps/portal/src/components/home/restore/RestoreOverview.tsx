import type { ReactNode } from "react";
import { TbInfoCircle } from "react-icons/tb";
import { Section } from "@/components/common/Section";
import { labelOf, MODE_COPY } from "@/components/settings/backup/labels";
import type { ArchiveSummary } from "@/services/projects";
import { iconOf } from "./SectionBrowser";

/** The first page: what the user fills in, where the file comes from, what it holds and what to know. */
export function RestoreOverview({
	summary,
	fields,
	onOpenSection,
	notice,
}: {
	notice?: ReactNode;
	summary: Omit<ArchiveSummary, "suggested">;
	fields: ReactNode;
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
				{notice && (
					<div
						role="note"
						className="flex gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm text-foreground"
					>
						<TbInfoCircle size={18} className="mt-0.5 shrink-0 text-accent" />
						<div>{notice}</div>
					</div>
				)}
				{fields}

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
			</div>
		</div>
	);
}
