import type { AuditRow } from "@/services/auditLogs";

const VIA: Record<Exclude<AuditRow["source"], "portal">, string> = {
	mcp: "MCP",
	pat: "PAT",
	agent: "agent",
};

export const SOURCE_OPTIONS: { value: AuditRow["source"]; label: string }[] = [
	{ value: "portal", label: "Portal" },
	{ value: "pat", label: "Personal access token" },
	{ value: "agent", label: "AI agent" },
	{ value: "mcp", label: "MCP" },
];

/** "via MCP by a@b.io", or just the email for a portal sign-in. A key-holder with no user is "System". */
export function actorLabel(row: Pick<AuditRow, "source" | "actorId" | "actorEmail">) {
	if (row.actorId === "system") return "System";
	return row.source === "portal" ? row.actorEmail : `via ${VIA[row.source]} by ${row.actorEmail}`;
}

/** The project's name as the event saw it; "Instance" for events that belong to no project. */
export function projectLabel(row: Pick<AuditRow, "projectId" | "projectName" | "projectSlug">) {
	if (!row.projectId) return "Instance";
	return row.projectName || row.projectSlug || row.projectId;
}
