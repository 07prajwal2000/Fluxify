import { Link } from "@tanstack/react-router";
import { versionsQuery } from "@/query/versionsQuery";
import type { VersionKind } from "@/services/versions";
import { isDeployTool, summarizeInput } from "./agentApproval";

const KINDS = ["route", "workflow", "custom_block", "middleware"] as const;
const asKind = (k: unknown): VersionKind | undefined =>
	KINDS.includes(k as VersionKind) ? (k as VersionKind) : undefined;

/** The version history route and its params, per kind (#738, #740). */
function historyTarget(kind: VersionKind, projectId: string, id: string) {
	if (kind === "route")
		return { to: "/$projectId/canvas/$routeId/versions", params: { projectId, routeId: id } };
	if (kind === "workflow")
		return {
			to: "/$projectId/workflow-canvas/$workflowId/versions",
			params: { projectId, workflowId: id },
		};
	if (kind === "custom_block")
		return {
			to: "/$projectId/custom-block-canvas/$blockId/versions",
			params: { projectId, blockId: id },
		};
	return {
		to: "/$projectId/middlewares/$middlewareId/versions",
		params: { projectId, middlewareId: id },
	};
}

/**
 * The version a promote or rollback approval puts live (#739, #778): a link to
 * its read-only canvas, shown as its number and title rather than the raw id.
 * Until the version is read it reads "this version", never the UUID.
 */
function DeployVersionLink({ projectId, input }: { projectId: string; input: unknown }) {
	const i = (input ?? {}) as { kind?: unknown; id?: unknown; versionId?: unknown };
	const kind = asKind(i.kind);
	const target = typeof i.id === "string" ? i.id : "";
	const versionId = typeof i.versionId === "string" ? i.versionId : "";
	const { data } = versionsQuery.list.useQuery(kind ?? "route", kind ? target : "");
	const version = data?.versions.find((v) => v.id === versionId);
	const label = version ? `v${version.versionNumber} · ${version.title}` : "this version";
	const className = "truncate font-mono text-xs text-accent underline-offset-2 hover:underline";
	if (!kind || !target)
		return <span className="truncate font-mono text-xs text-muted">{label}</span>;
	const t = historyTarget(kind, projectId, target);
	return (
		<Link to={t.to as never} params={t.params as never} className={className}>
			{label}
		</Link>
	);
}

/** A waiting call's target line: a version link for a promote or rollback, the input summary otherwise. */
export function ApprovalTarget({
	projectId,
	name,
	input,
}: {
	projectId: string;
	name: string;
	input: unknown;
}) {
	if (isDeployTool(name)) return <DeployVersionLink projectId={projectId} input={input} />;
	return (
		<span className="truncate font-mono text-xs text-muted">{summarizeInput(name, input)}</span>
	);
}
