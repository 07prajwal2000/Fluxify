import type { ReactNode } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import type { PluginUpgradeDiff } from "@/services/plugins";
import { Badge } from "./PluginBadges";
import { type PluginUser, PluginUserLinks } from "./PluginUserLink";

function Section({
	title,
	tone,
	children,
}: {
	title: string;
	tone?: "danger";
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-1.5">
			<h4
				className={`text-xs font-semibold uppercase tracking-wider ${tone === "danger" ? "text-danger" : "text-muted"}`}
			>
				{title}
			</h4>
			<ul className="flex flex-col gap-1.5 text-xs text-foreground">{children}</ul>
		</section>
	);
}

function Item({
	children,
	usedBy,
	projectId,
}: {
	children: ReactNode;
	usedBy?: PluginUser[];
	projectId: string;
}) {
	return (
		<li className="flex flex-col gap-0.5">
			<span>{children}</span>
			{usedBy && usedBy.length > 0 && (
				<span className="flex flex-wrap items-center gap-2 pl-3 text-muted">
					used by <PluginUserLinks users={usedBy} projectId={projectId} />
				</span>
			)}
		</li>
	);
}

const code = (s: string) => <code className="font-mono">{s}</code>;
const handleNames = (h: Record<string, unknown>) =>
	Object.entries(h)
		.map(
			([side, names]) =>
				`${side}: ${Array.isArray(names) ? names.join(", ") || "none" : String(names)}`,
		)
		.join(" · ");

/**
 * What an upgrade changes for the project: what it takes away (with who uses
 * it), what it adds, and what blocks approving. The upgrade preview and the 409
 * of a refused approval carry the same diff, so both render here.
 */
export function UpgradeDiff({ diff, projectId }: { diff: PluginUpgradeDiff; projectId: string }) {
	const p = diff.addedPermissions;
	const deprecations = [...diff.deprecations].sort((a, b) => Number(b.inUse) - Number(a.inUse));
	return (
		<div className="flex flex-col gap-4" data-testid="upgrade-diff">
			{diff.blocking && (
				<div
					role="alert"
					className="flex gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-foreground"
				>
					<TbAlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" />
					<div className="flex flex-col gap-1">
						<p className="font-medium text-danger">
							This upgrade cannot be approved: it takes away something the project uses.
						</p>
						<ul className="list-disc pl-4">
							{diff.blockers.map((b) => (
								<li key={b}>{b}</li>
							))}
						</ul>
					</div>
				</div>
			)}
			{diff.removedBlocks.length > 0 && (
				<Section title="Removed blocks" tone="danger">
					{diff.removedBlocks.map((r) => (
						<Item key={r.block} usedBy={r.usedBy} projectId={projectId}>
							{code(r.block)}
						</Item>
					))}
				</Section>
			)}
			{diff.removedParams.length > 0 && (
				<Section title="Removed params" tone="danger">
					{diff.removedParams.map((r) => (
						<Item key={`${r.block}.${r.param}`} usedBy={r.usedBy} projectId={projectId}>
							{code(r.param)} of {code(r.block)}
						</Item>
					))}
				</Section>
			)}
			{diff.removedHandles.length > 0 && (
				<Section title="Removed handles" tone="danger">
					{diff.removedHandles.map((r) => (
						<Item key={`${r.block}.${r.handle}`} usedBy={r.usedBy} projectId={projectId}>
							{code(r.handle)} of {code(r.block)}
						</Item>
					))}
				</Section>
			)}
			{diff.changedInvoke.length > 0 && (
				<Section title="Changed invoke modes">
					{diff.changedInvoke.map((r) => (
						<Item key={r.block} usedBy={r.usedBy} projectId={projectId}>
							{code(r.block)}
							{r.removed.length > 0 && <> no longer {r.removed.join(", ")}</>}
							{r.added.length > 0 && <> now also {r.added.join(", ")}</>}
						</Item>
					))}
				</Section>
			)}
			{diff.changedHandlesOrShape.length > 0 && (
				<Section title="Changed shape or handles">
					{diff.changedHandlesOrShape.map((r) => (
						<Item key={r.block} projectId={projectId}>
							{code(r.block)}: {r.before.shape} → {r.after.shape}; {handleNames(r.after.handles)}
						</Item>
					))}
				</Section>
			)}
			{(p.integrations.length > 0 || p.appconfig) && (
				<Section title="New permissions">
					{p.integrations.map((i) => (
						<Item key={i} projectId={projectId}>
							Integrations: {code(i)}
						</Item>
					))}
					{p.appconfig && <Item projectId={projectId}>App config</Item>}
				</Section>
			)}
			{diff.addedBlocks.length > 0 && (
				<Section title="New blocks">
					{diff.addedBlocks.map((b) => (
						<Item key={b} projectId={projectId}>
							{code(b)}
						</Item>
					))}
				</Section>
			)}
			{deprecations.length > 0 && (
				<Section title="Deprecations">
					{deprecations.map((d) => (
						<Item key={`${d.block}.${d.param ?? ""}.${d.handle ?? ""}`} projectId={projectId}>
							<span className="flex flex-wrap items-center gap-2">
								{code([d.block, d.param, d.handle].filter(Boolean).join(" · "))}
								{d.inUse ? (
									<Badge tone="warning">In use</Badge>
								) : (
									<Badge tone="muted">Not in use</Badge>
								)}
							</span>
							<span className="text-muted">{d.message}</span>
						</Item>
					))}
				</Section>
			)}
		</div>
	);
}
