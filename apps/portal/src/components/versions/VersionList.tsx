import { Button, cn, Dropdown, Label, toast } from "@fluxify/components";
import {
	TbArrowBackUp,
	TbCopy,
	TbDotsVertical,
	TbFlask,
	TbGitBranch,
	TbPlayerRecord,
	TbRocket,
} from "react-icons/tb";
import { getTimeAgo } from "@/lib/datetime";
import type { Version, VersionKind } from "@/services/versions";

export type VersionAction = "checkout" | "sandbox" | "deploy" | "recordings";

/** Open in sandbox and View recordings are a route's and a workflow's, not a block's (#740). */
const isCanvasKind = (kind: VersionKind) => kind === "route" || kind === "workflow";

/** the name, else the email, else a person no longer in the project */
const authorOf = (version: Version) => version.author ?? version.authorEmail ?? "Unknown author";

/** Promoting a version older than the live one is a rollback (#739). */
export function deployAction(version: Version, liveVersionNumber: number | null) {
	if (version.isProd) return null;
	const rollback = liveVersionNumber !== null && version.versionNumber < liveVersionNumber;
	return {
		label: rollback ? "Roll back to this version" : "Promote to production",
		icon: rollback ? <TbArrowBackUp size={16} /> : <TbRocket size={16} />,
	};
}

function VersionMenu({
	version,
	kind,
	canEdit,
	liveVersionNumber,
	onAction,
}: {
	version: Version;
	kind: VersionKind;
	canEdit: boolean;
	liveVersionNumber: number | null;
	onAction: (action: VersionAction, version: Version) => void;
}) {
	async function copyId() {
		try {
			await navigator.clipboard.writeText(version.id);
			toast.success("Version id copied");
		} catch {
			toast.danger("Could not copy the version id");
		}
	}

	const deploy = deployAction(version, liveVersionNumber);

	return (
		<Dropdown>
			<Button isIconOnly size="sm" variant="ghost" aria-label={`v${version.versionNumber} options`}>
				<TbDotsVertical size={16} />
			</Button>
			<Dropdown.Popover>
				<Dropdown.Menu
					onAction={(key) => {
						if (key === "copy") void copyId();
						else onAction(key as VersionAction, version);
					}}
				>
					{canEdit ? (
						<Dropdown.Item id="checkout" textValue="Check out">
							<TbGitBranch size={16} />
							<Label>Check out</Label>
						</Dropdown.Item>
					) : null}
					{canEdit && isCanvasKind(kind) ? (
						<Dropdown.Item id="sandbox" textValue="Open in sandbox">
							<TbFlask size={16} />
							<Label>Open in sandbox</Label>
						</Dropdown.Item>
					) : null}
					{canEdit && deploy ? (
						<Dropdown.Item id="deploy" textValue={deploy.label}>
							{deploy.icon}
							<Label>{deploy.label}</Label>
						</Dropdown.Item>
					) : null}
					{canEdit && isCanvasKind(kind) ? (
						<Dropdown.Item id="recordings" textValue="View recordings">
							<TbPlayerRecord size={16} />
							<Label>View recordings</Label>
						</Dropdown.Item>
					) : null}
					<Dropdown.Item id="copy" textValue="Copy version id">
						<TbCopy size={16} />
						<Label>Copy version id</Label>
					</Dropdown.Item>
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);
}

/**
 * The versions, newest first (#738). A top row stands in for work no version
 * holds yet and leads back to the canvas, where it can be committed. The live
 * version carries an "In production" badge (#739).
 */
export function VersionList({
	kind,
	versions,
	uncommitted,
	selectedId,
	canEdit,
	liveVersionNumber,
	onSelect,
	onOpenCanvas,
	onAction,
}: {
	kind: VersionKind;
	versions: Version[];
	uncommitted: boolean;
	selectedId: string | undefined;
	canEdit: boolean;
	/** production's version number now, for the promote/rollback wording */
	liveVersionNumber: number | null;
	onSelect: (versionId: string) => void;
	onOpenCanvas: () => void;
	onAction: (action: VersionAction, version: Version) => void;
}) {
	return (
		<ul aria-label="Versions" className="flex flex-col">
			{uncommitted && (
				<li>
					<button
						type="button"
						onClick={onOpenCanvas}
						className="group flex w-full items-center gap-2 border-b border-border px-4 py-3 text-left text-sm hover:bg-surface-secondary"
					>
						<span className="size-2 shrink-0 rounded-full bg-warning" />
						<span className="font-medium">Uncommitted changes</span>
						{/* HEAD belongs here while the canvas has work no version holds (#738) */}
						<span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
							HEAD
						</span>
						<span className="ml-auto text-xs font-medium text-accent underline underline-offset-2 group-hover:no-underline">
							Open canvas
						</span>
					</button>
				</li>
			)}
			{versions.map((version) => (
				<li
					key={version.id}
					className={cn(
						"flex items-start gap-1 border-b border-border pr-2 hover:bg-surface-secondary",
						version.id === selectedId && "bg-accent/10",
					)}
				>
					<button
						type="button"
						aria-current={version.id === selectedId}
						onClick={() => onSelect(version.id)}
						className="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-3 text-left"
					>
						<span className="flex items-center gap-2 text-sm">
							<span className="font-mono font-semibold">v{version.versionNumber}</span>
							{version.isProd && (
								<span className="rounded-md bg-success/10 px-1.5 py-0.5 text-[11px] font-medium text-success">
									In production
								</span>
							)}
							{version.isHead && !uncommitted && (
								<span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
									HEAD
								</span>
							)}
						</span>
						<span className="truncate text-sm">{version.title}</span>
						<span className="truncate text-xs text-muted">
							{authorOf(version)} ·{" "}
							<time
								dateTime={version.createdAt}
								title={new Date(version.createdAt).toLocaleString()}
							>
								{getTimeAgo(version.createdAt)}
							</time>
						</span>
					</button>
					<div className="pt-2">
						<VersionMenu
							version={version}
							kind={kind}
							canEdit={canEdit}
							liveVersionNumber={liveVersionNumber}
							onAction={onAction}
						/>
					</div>
				</li>
			))}
		</ul>
	);
}
