import { Button, cn, Spinner, Tabs } from "@fluxify/components";
import { useState } from "react";
import { TbArrowLeft } from "react-icons/tb";
import { OpenInSandboxDialog } from "@/components/sandboxes/OpenInSandboxDialog";
import { copyWarnings } from "@/components/sandboxes/openInSandbox";
import { versionsQuery } from "@/query/versionsQuery";
import type { Version, VersionKind } from "@/services/versions";
import { useCanEditProject } from "@/store/auth";
import { CheckoutDialog } from "./CheckoutDialog";
import { DeployDialog } from "./DeployDialog";
import { ProductionPanel } from "./ProductionPanel";
import { useVersionTarget } from "./useVersionTarget";
import { VersionCanvas, versionItems } from "./VersionCanvas";
import { type VersionAction, VersionList } from "./VersionList";
import { VersionSettings } from "./VersionSettings";

/** Which half of the history the left column shows (#739). */
export type VersionTab = "versions" | "production";

const hasSchema = (schema: unknown) =>
	!!schema && Object.keys(schema as Record<string, unknown>).length > 0;

/** The sandbox copy of one version: its own blocks, and what it lacks said as the live copy's does. */
function SandboxFromVersion({
	kind,
	id,
	projectId,
	version,
	onClose,
	onOpen,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
	version: Version;
	onClose: () => void;
	onOpen: (sandboxId: string) => void;
}) {
	const { name } = useVersionTarget(kind, id);
	const { data } = versionsQuery.get.useQuery(kind, id, version.id);
	if (!data) return null;
	const settings = data.snapshot.settings as Record<string, unknown>;
	const middlewares = (settings.middlewares ?? {}) as { before?: string[]; after?: string[] };
	return (
		<OpenInSandboxDialog
			open
			projectId={projectId}
			source={{ kind, id, name: `${name} v${version.versionNumber}` }}
			canvas={versionItems(data.snapshot)}
			warnings={
				kind === "route"
					? copyWarnings({
							hasMiddlewares:
								(middlewares.before?.length ?? 0) + (middlewares.after?.length ?? 0) > 0,
							hasSchemas: [settings.bodySchema, settings.querySchema, settings.paramsSchema].some(
								hasSchema,
							),
						})
					: []
			}
			onOpenChange={(open) => !open && onClose()}
			onOpen={onOpen}
		/>
	);
}

function SelectedVersion({
	kind,
	id,
	projectId,
	version,
	settingsOpen,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
	version: Version;
	settingsOpen: boolean;
}) {
	const { data, isLoading, isError } = versionsQuery.get.useQuery(kind, id, version.id);
	return (
		<section className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="border-b border-border px-4 py-2">
				<p className="text-sm font-medium">
					<span className="font-mono">v{version.versionNumber}</span> · {version.title}
				</p>
				{version.description && <p className="text-xs text-muted">{version.description}</p>}
			</div>
			{isLoading ? (
				<div className="flex flex-1 items-center justify-center">
					<Spinner />
				</div>
			) : isError || !data ? (
				<div className="flex flex-1 items-center justify-center text-muted">
					Couldn't load this version.
				</div>
			) : (
				<div className="flex min-h-0 flex-1">
					<div className="min-w-0 flex-1">
						{/* keyed: each version opens on its own view */}
						<VersionCanvas key={version.id} snapshot={data.snapshot} />
					</div>
					<aside
						className={cn(
							"shrink-0 border-l border-border transition-[width] duration-200",
							settingsOpen ? "w-80 overflow-y-auto" : "w-0 overflow-hidden border-l-0",
						)}
					>
						{settingsOpen && (
							<VersionSettings
								kind={kind}
								projectId={projectId}
								settings={data.snapshot.settings as Record<string, unknown>}
							/>
						)}
					</aside>
				</div>
			)}
		</section>
	);
}

/**
 * A route's or workflow's version history (#738): Versions and Production tabs
 * on the left, the chosen one read-only on the right. Check out and Open in
 * sandbox are for creators; anyone with access can read. The right settings
 * panel collapses from the page header (#739).
 */
export function VersionHistory({
	kind,
	id,
	projectId,
	tab,
	onTabChange,
	settingsOpen,
	onBackToCanvas,
	onOpenSandbox,
	onViewRecordings,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
	tab: VersionTab;
	onTabChange: (tab: VersionTab) => void;
	settingsOpen: boolean;
	onBackToCanvas: () => void;
	onOpenSandbox: (sandboxId: string) => void;
	/** the version menu's "View recordings": opens the executions list filtered to it */
	onViewRecordings?: (versionId: string) => void;
}) {
	const canEdit = useCanEditProject(projectId);
	const { data, isLoading, isError } = versionsQuery.list.useQuery(kind, id);
	const [picked, setPicked] = useState<string>();
	const [action, setAction] = useState<{ type: VersionAction; version: Version }>();

	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spinner />
			</div>
		);
	}
	if (isError || !data) {
		return (
			<div className="flex flex-1 items-center justify-center text-muted">
				Couldn't load the versions.
			</div>
		);
	}

	const { versions, uncommitted } = data;
	const liveVersionNumber = versions.find((v) => v.isProd)?.versionNumber ?? null;
	const selected =
		versions.find((v) => v.id === picked) ?? versions.find((v) => v.isHead) ?? versions[0];

	return (
		<div className="flex min-h-0 flex-1">
			<aside className="flex w-80 shrink-0 flex-col border-r border-border">
				<div className="border-b border-border p-2">
					<Button variant="ghost" size="sm" onPress={onBackToCanvas}>
						<TbArrowLeft size={14} /> Back to canvas
					</Button>
				</div>
				<Tabs
					selectedKey={tab}
					onSelectionChange={(key) => onTabChange(key as VersionTab)}
					variant="secondary"
					className="flex min-h-0 flex-1 flex-col"
				>
					<Tabs.ListContainer className="px-2 pt-2">
						<Tabs.List aria-label="History">
							<Tabs.Tab id="versions">
								Versions
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="production">
								Production
								<Tabs.Indicator />
							</Tabs.Tab>
						</Tabs.List>
					</Tabs.ListContainer>
					<Tabs.Panel id="versions" className="min-h-0 flex-1 overflow-y-auto">
						<VersionList
							versions={versions}
							uncommitted={uncommitted}
							selectedId={selected?.id}
							canEdit={canEdit}
							liveVersionNumber={liveVersionNumber}
							onSelect={setPicked}
							onOpenCanvas={onBackToCanvas}
							onAction={(type, version) => {
								if (type === "recordings") onViewRecordings?.(version.id);
								else setAction({ type, version });
							}}
						/>
					</Tabs.Panel>
					<Tabs.Panel id="production" className="min-h-0 flex-1 overflow-y-auto">
						<ProductionPanel kind={kind} id={id} projectId={projectId} versions={versions} />
					</Tabs.Panel>
				</Tabs>
			</aside>
			{selected ? (
				<SelectedVersion
					kind={kind}
					id={id}
					projectId={projectId}
					version={selected}
					settingsOpen={settingsOpen}
				/>
			) : (
				<div className="flex min-w-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted">
					No versions yet. Commit to save the first one.
				</div>
			)}
			{action?.type === "checkout" && (
				<CheckoutDialog
					kind={kind}
					id={id}
					version={action.version}
					uncommitted={uncommitted}
					onClose={() => setAction(undefined)}
					onCheckedOut={onBackToCanvas}
				/>
			)}
			{action?.type === "sandbox" && (
				<SandboxFromVersion
					kind={kind}
					id={id}
					projectId={projectId}
					version={action.version}
					onClose={() => setAction(undefined)}
					onOpen={onOpenSandbox}
				/>
			)}
			{action?.type === "deploy" && (
				<DeployDialog
					kind={kind}
					id={id}
					projectId={projectId}
					version={action.version}
					liveVersionNumber={liveVersionNumber}
					onClose={() => setAction(undefined)}
				/>
			)}
		</div>
	);
}
