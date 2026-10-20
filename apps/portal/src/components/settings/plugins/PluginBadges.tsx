import { cn } from "@fluxify/components";
import type { Plugin } from "@/services/plugins";

const TONE = {
	success: "bg-success/10 text-success",
	warning: "bg-warning/10 text-warning",
	danger: "bg-danger/10 text-danger",
	muted: "bg-surface-secondary text-muted",
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: string }) {
	return (
		<span className={cn("shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium", TONE[tone])}>
			{children}
		</span>
	);
}

/** A pending row with a `live` version is an upgrade: the old version keeps serving. */
export const isUpgrade = (p: Plugin) => p.approval === "pending" && p.live !== null;

export function ApprovalBadge({ plugin }: { plugin: Plugin }) {
	if (isUpgrade(plugin)) return <Badge tone="warning">Upgrade pending</Badge>;
	if (plugin.approval === "approved") return <Badge tone="success">Approved</Badge>;
	if (plugin.approval === "rejected") return <Badge tone="danger">Rejected</Badge>;
	return <Badge tone="warning">Pending approval</Badge>;
}

export function StatusBadge({ plugin }: { plugin: Plugin }) {
	return plugin.status === "ok" ? (
		<Badge tone="success">OK</Badge>
	) : (
		<Badge tone="danger">Error</Badge>
	);
}

/** `1.0.0`, or `1.0.0 → 1.1.0` while an upgrade waits for approval */
export const versionLabel = (p: Plugin) =>
	isUpgrade(p) ? `${p.live?.version} → ${p.version}` : p.version;

export const SOURCE_LABEL: Record<Plugin["source"], string> = {
	upload: "Upload",
	npm: "npm",
	url: "URL",
	fs: "Folder",
};

export const formatTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never");
