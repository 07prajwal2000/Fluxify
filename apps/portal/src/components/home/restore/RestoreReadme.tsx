import { MarkdownViewer } from "@/components/ai/MarkdownViewer";

/** The README's own page; untrusted, so Markdown only (no raw HTML), links open in a new tab. */
export function RestoreReadme({ text }: { text: string }) {
	return (
		<div className="h-full overflow-y-auto p-6">
			<section aria-label="README" className="max-w-4xl">
				<MarkdownViewer content={text} />
			</section>
		</div>
	);
}
