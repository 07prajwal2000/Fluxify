import { blockDocPage, toPanelMarkdown } from "./blockDocs";

// `docs/blocks` is the one source of truth; Vite inlines the pages at build time.
// Outside Vite (bun test) `import.meta.glob` doesn't exist: no pages then.
let pages: Record<string, string> = {};
try {
	pages = import.meta.glob<string>("../../../../../../../docs/blocks/*.md", {
		query: "?raw",
		import: "default",
		eager: true,
	});
} catch {}

const byName = new Map(
	Object.entries(pages).map(([path, source]) => [
		path.split("/").pop()!.replace(/\.md$/, ""),
		source,
	]),
);

/** The block's doc page ready for `MarkdownViewer`, or undefined when it has none. */
export function builtinBlockDocs(type: string) {
	const page = blockDocPage(type);
	const source = page && byName.get(page);
	return source ? { page, markdown: toPanelMarkdown(source, page) } : undefined;
}
