import { Chip } from "@fluxify/components";
import { Link, useParams } from "@tanstack/react-router";
import { TbGitCommit } from "react-icons/tb";
import { formatWhen } from "@/components/testSuites/RunResults";
import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";

const KINDS = ["route", "workflow", "custom_block", "middleware"] as const;
type Kind = (typeof KINDS)[number];
const asKind = (k: unknown): Kind | undefined =>
	KINDS.includes(k as Kind) ? (k as Kind) : undefined;

/** The version history page a version opens on, read-only (#780). */
function versionsPath(kind: Kind, projectId: string, id: string) {
	if (kind === "route") return `/${projectId}/canvas/${id}/versions`;
	if (kind === "workflow") return `/${projectId}/workflow-canvas/${id}/versions`;
	if (kind === "custom_block") return `/${projectId}/custom-block-canvas/${id}/versions`;
	return `/${projectId}/middlewares/${id}/versions`;
}

/**
 * get_version and commit_version (#780): the version's number, title, author and
 * date, and a link that opens its read-only canvas in the version history. The
 * id is never shown: an unknown version reads "this version".
 */
export function VersionCard({ tool }: { tool: ToolPart }) {
	const { projectId = "" } = useParams({ strict: false }) as { projectId?: string };
	const input = rec(tool.input);
	const out = rec(tool.output);
	const kind = asKind(input.kind);
	const target = str(input.id);
	const versionId = str(out.versionId);
	const number = out.versionNumber !== undefined ? `v${str(out.versionNumber)}` : "";
	const title = str(out.title);
	const committed = tool.name === "commit_version";
	const path = kind && target && versionId ? versionsPath(kind, projectId, target) : undefined;
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-xs">
			<header className="flex flex-wrap items-center gap-2">
				<TbGitCommit size={15} className="shrink-0 text-muted" aria-hidden />
				<span className="font-medium text-foreground">
					{committed ? "Committed" : "Version"} {number}
					{title ? ` · ${title}` : ""}
				</span>
				{out.isProd === true && (
					<Chip size="sm" color="accent">
						Prod
					</Chip>
				)}
			</header>
			{(out.author !== undefined || out.createdAt !== undefined) && (
				<dl className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
					{out.author !== undefined && (
						<div className="flex gap-1">
							<dt>Author</dt>
							<dd className="text-foreground">{str(out.author)}</dd>
						</div>
					)}
					{out.createdAt !== undefined && (
						<div className="flex gap-1">
							<dt>Date</dt>
							<dd className="text-foreground">{formatWhen(out.createdAt)}</dd>
						</div>
					)}
				</dl>
			)}
			{out.description !== undefined && out.description !== "" && (
				<p className="text-muted">{str(out.description)}</p>
			)}
			{path && (
				<Link
					to={path}
					search={{ version: versionId } as never}
					target="_blank"
					rel="noopener noreferrer"
					className="w-fit text-accent underline-offset-2 hover:underline"
				>
					Open {number || "this version"}'s read-only canvas
				</Link>
			)}
		</div>
	);
}
