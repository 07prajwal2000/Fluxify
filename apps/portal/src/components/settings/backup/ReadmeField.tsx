import { cn, Label, Tabs, TextArea, TextField } from "@fluxify/components";
import { MarkdownViewer } from "@/components/ai/MarkdownViewer";
import { byteLength } from "./format";

/** the archive's limit (`MAX_README_BYTES` on the server) */
export const README_MAX_BYTES = 64 * 1024;

/**
 * The note that travels inside the archive, so whoever imports it reads the
 * instructions before applying it (#1103). Write and Preview share one value.
 * Highlighted for a template, whose reader is someone else.
 */
export function ReadmeField({
	value,
	onChange,
	highlight,
}: {
	value: string;
	onChange: (value: string) => void;
	highlight: boolean;
}) {
	const size = byteLength(value);
	const tooLong = size > README_MAX_BYTES;
	return (
		<section
			aria-label="README"
			className={cn(
				"flex flex-col gap-2 rounded-lg border p-4",
				highlight ? "border-accent bg-accent/5" : "border-border bg-surface",
			)}
		>
			<div>
				<h3 className="text-sm font-semibold text-foreground">README (optional)</h3>
				<p className="text-xs text-muted">
					{highlight
						? "Whoever creates a project from this template reads it first. Say what to set up before using it."
						: "Whoever restores this backup can read it before applying it."}
				</p>
			</div>
			<Tabs variant="secondary" defaultSelectedKey="write">
				{/* the secondary variant draws the underline through the container and one
				    indicator inside each tab; without them the tabs are plain text */}
				<Tabs.ListContainer>
					<Tabs.List aria-label="README">
						<Tabs.Tab id="write">
							Write
							<Tabs.Indicator />
						</Tabs.Tab>
						<Tabs.Tab id="preview">
							Preview
							<Tabs.Indicator />
						</Tabs.Tab>
					</Tabs.List>
				</Tabs.ListContainer>
				<Tabs.Panel id="write" className="pt-3">
					<TextField fullWidth variant="secondary" value={value} onChange={onChange}>
						<Label className="sr-only">README text (Markdown)</Label>
						<TextArea
							rows={8}
							placeholder="Markdown: what this is, and what to do before restoring it"
						/>
					</TextField>
				</Tabs.Panel>
				<Tabs.Panel id="preview" className="min-h-[12rem] pt-3">
					{value.trim() ? (
						<MarkdownViewer content={value} />
					) : (
						<p className="text-sm text-muted">Nothing to preview yet.</p>
					)}
				</Tabs.Panel>
			</Tabs>
			<p className={cn("text-xs", tooLong ? "text-danger" : "text-muted")}>
				Stored unencrypted. Don't put secrets here.
				{tooLong && ` It is ${Math.ceil(size / 1024)} KB; the limit is 64 KB.`}
			</p>
		</section>
	);
}
