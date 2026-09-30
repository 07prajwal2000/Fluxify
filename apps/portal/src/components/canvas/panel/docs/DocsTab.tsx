import { useParams } from "@tanstack/react-router";
import { TbExternalLink } from "react-icons/tb";
import { MarkdownViewer } from "@/components/ai/MarkdownViewer";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { docsPageUrl } from "./blockDocs";
import { builtinBlockDocs } from "./blockDocsContent";

/** Built-in blocks read their `docs/blocks` page; custom blocks their own `docs`. */
export function DocsTab({ type }: { type: string }) {
	const builtin = builtinBlockDocs(type);
	const params = useParams({ strict: false }) as { projectId?: string };
	const { data: customBlocks } = customBlocksQuery.getAll.useQuery(params.projectId ?? "");
	const markdown = builtin?.markdown ?? customBlocks?.find((cb) => cb.name === type)?.docs;

	if (!markdown?.trim()) {
		return (
			<div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted">
				No docs found.
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3 pt-1">
			{builtin && (
				<a
					href={docsPageUrl(builtin.page)}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-1 self-end text-xs text-accent hover:underline"
				>
					Open full docs <TbExternalLink size={13} />
				</a>
			)}
			<MarkdownViewer content={markdown} />
		</div>
	);
}
