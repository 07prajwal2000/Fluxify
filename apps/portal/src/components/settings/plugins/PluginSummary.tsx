import { requestedPermissions } from "@fluxify/server/src/modules/plugins/meta";
import type { ReactNode } from "react";
import { TbCheck, TbExternalLink, TbX } from "react-icons/tb";
import type { Plugin, PluginManifest } from "@/services/plugins";
import { Badge, formatTime, SOURCE_LABEL } from "./PluginBadges";
import { PluginBlockIcon, PluginTriggerIcon } from "./pluginBlockIcon";

export const manifestOf = (p: Plugin) => p.manifest as unknown as PluginManifest;

/** the block's own type below the plugin: `acme/slack/messages/post` → `messages/post` */
const blockPath = (type: string) => type.split("/").slice(2).join("/");

export function PluginBlocks({ plugin }: { plugin: Plugin }) {
	const blocks = Object.values(manifestOf(plugin).blocks);
	return (
		<ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
			{blocks.map((b) => (
				<li key={b.name} className="flex items-start gap-3 px-3 py-2">
					<PluginBlockIcon block={b} size={18} />
					<div className="flex min-w-0 flex-col gap-0.5">
						<div className="flex flex-wrap items-center gap-2 text-sm">
							<span className="font-medium text-foreground">{b.label}</span>
							<code className="font-mono text-xs text-muted">{blockPath(b.name)}</code>
							{b.deprecated && <Badge tone="warning">Deprecated</Badge>}
						</div>
						{b.description && <p className="text-xs text-muted">{b.description}</p>}
						<p className="text-xs text-muted">
							{b.shape} shape · {b.invoke.join(", ")}
						</p>
						{b.deprecated && <p className="text-xs text-warning">{b.deprecated}</p>}
					</div>
				</li>
			))}
		</ul>
	);
}

type TriggerKind = NonNullable<PluginManifest["triggers"]>[number];

const triggerPermissions = (kind: TriggerKind) => {
	const parts = [
		...(kind.permissions.integrations?.length
			? [`Integrations: ${kind.permissions.integrations.join(", ")}`]
			: []),
		...(kind.permissions.appconfig ? ["Read app config"] : []),
	];
	return parts.length ? parts.join(" · ") : "No special permissions.";
};

const triggerSecrets = (kind: TriggerKind) =>
	Object.entries(kind.params ?? {})
		.filter(([, param]) => (param as { type?: string }).type === "secret")
		.map(([name]) => name);

/** The trigger kinds a version ships: label, kind, permissions and whether they retry. */
export function PluginTriggerKinds({ plugin }: { plugin: Plugin }) {
	const triggers = manifestOf(plugin).triggers ?? [];
	if (triggers.length === 0) return null;
	return (
		<ul
			aria-label="Trigger kinds"
			data-testid="plugin-trigger-kinds"
			className="flex flex-col divide-y divide-border rounded-lg border border-border"
		>
			{triggers.map((kind) => {
				const secrets = triggerSecrets(kind);
				return (
					<li key={kind.name} className="flex items-start gap-3 px-3 py-2">
						<span className="mt-0.5 text-muted">
							<PluginTriggerIcon icon={kind.icon} size={18} />
						</span>
						<div className="flex min-w-0 flex-col gap-0.5">
							<div className="flex flex-wrap items-center gap-2 text-sm">
								<span className="font-medium text-foreground">{kind.label}</span>
								<code className="font-mono text-xs text-muted">{kind.name}</code>
								{kind.retry && <Badge tone="muted">Retries</Badge>}
							</div>
							{kind.description && <p className="text-xs text-muted">{kind.description}</p>}
							<p className="text-xs text-muted">{triggerPermissions(kind)}</p>
							{secrets.length > 0 && (
								<p className="text-xs text-muted">
									Secret params (App Config):{" "}
									<span className="font-mono text-foreground">{secrets.join(", ")}</span>
								</p>
							)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

export function PluginIntegrations({ plugin }: { plugin: Plugin }) {
	const manifest = manifestOf(plugin) as any;
	const integrations =
		plugin.integrations ??
		(manifest?.integrations ?? []).map((e: any) => ({
			group: e.group,
			variant: e.variant,
			label: e.label ?? e.variant,
			ownGroup: !["database", "kv", "ai", "baas", "observability", "queue", "mcp"].includes(
				e.group,
			),
			secretParams: e.secretParams ?? [],
			hooks: {
				test: Boolean(e.hasTest),
				describe: Boolean(e.hasDescribe),
				inspect: Boolean(e.hasInspect),
			},
		}));

	if (!integrations || integrations.length === 0) return null;

	return (
		<ul
			className="flex flex-col divide-y divide-border rounded-lg border border-border"
			data-testid="plugin-integrations-list"
		>
			{integrations.map((item: any) => {
				const kind = `${item.group}/${item.variant}`;
				const hooksList = [
					item.hooks?.test && "test",
					item.hooks?.describe && "describe",
					item.hooks?.inspect && "inspect",
				].filter(Boolean) as string[];

				return (
					<li key={kind} className="flex flex-col gap-1 px-3 py-2 text-xs">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium text-foreground text-sm">{item.label}</span>
							<code className="font-mono text-xs text-muted">{kind}</code>
							{item.ownGroup && <Badge tone="muted">Plugin group</Badge>}
						</div>
						{item.secretParams && item.secretParams.length > 0 && (
							<p className="text-xs text-muted">
								Secret params (App Config):{" "}
								<span className="font-mono text-foreground">{item.secretParams.join(", ")}</span>
							</p>
						)}
						<div className="flex items-center gap-1.5 text-xs text-muted">
							<span>Hooks:</span>
							{hooksList.length > 0 ? (
								hooksList.map((h) => (
									<Badge key={h} tone="muted">
										{h}
									</Badge>
								))
							) : (
								<span>none</span>
							)}
						</div>
					</li>
				);
			})}
		</ul>
	);
}

const Tick = ({ on, label }: { on: boolean; label: string }) =>
	on ? (
		<TbCheck size={16} className="text-success" aria-label={label} />
	) : (
		<TbX size={16} className="text-muted" aria-label={`not ${label}`} />
	);

/**
 * What the version in the registry asks for against what a creator already
 * granted. While an upgrade waits, "granted" is what the version still serving
 * was approved with, so a new ask shows as requested but not granted.
 */
export function PluginPermissions({ plugin }: { plugin: Plugin }) {
	const requested = requestedPermissions(manifestOf(plugin));
	const granted = plugin.live?.permissions ??
		plugin.permissions ?? {
			integrations: [],
			appconfig: false,
		};
	const rows = [
		...[...new Set([...requested.integrations, ...granted.integrations])].sort().map((kind) => ({
			label: `Integration: ${kind}`,
			asked: requested.integrations.includes(kind),
			given: granted.integrations.includes(kind),
		})),
		{ label: "App config", asked: requested.appconfig, given: granted.appconfig },
	].filter((r) => r.asked || r.given);
	if (!rows.length)
		return <p className="text-sm text-muted">This plugin asks for no permissions.</p>;
	return (
		<table className="w-full text-sm" aria-label="Permissions">
			<thead>
				<tr className="text-left text-xs text-muted">
					<th className="py-1 font-medium">Permission</th>
					<th className="w-24 py-1 font-medium">Requested</th>
					<th className="w-24 py-1 font-medium">Granted</th>
				</tr>
			</thead>
			<tbody>
				{rows.map((r) => (
					<tr key={r.label} className="border-t border-border">
						<td className="py-1.5 text-foreground">{r.label}</td>
						<td>
							<Tick on={r.asked} label="requested" />
						</td>
						<td>
							<Tick on={r.given} label="granted" />
						</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex flex-col gap-0.5">
			<dt className="text-xs text-muted">{label}</dt>
			<dd className="break-all font-mono text-xs text-foreground">{children}</dd>
		</div>
	);
}

export function PluginProvenance({ plugin }: { plugin: Plugin }) {
	return (
		<dl className="grid grid-cols-2 gap-3">
			<Field label="Source">{SOURCE_LABEL[plugin.source]}</Field>
			<Field label="Location">{plugin.location}</Field>
			<Field label="Integrity">{plugin.integrity}</Field>
			<Field label="Compatible SDK">{plugin.sdkRange}</Field>
			<Field label="Last scanned">{formatTime(plugin.scannedAt)}</Field>
			<Field label="Docs">
				<a
					href={plugin.url}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-accent hover:underline"
				>
					{plugin.url} <TbExternalLink size={12} />
				</a>
			</Field>
		</dl>
	);
}
