import { Button, cn, Dropdown, Label, toast } from "@fluxify/components";
import { TbCopy, TbDotsVertical, TbFlask, TbGitBranch } from "react-icons/tb";
import { getTimeAgo } from "@/lib/datetime";
import type { Version } from "@/services/versions";

export type VersionAction = "checkout" | "sandbox";

/** the name, else the email, else a person no longer in the project */
const authorOf = (version: Version) => version.author ?? version.authorEmail ?? "Unknown author";

function VersionMenu({
	version,
	canEdit,
	onAction,
}: {
	version: Version;
	canEdit: boolean;
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
					{canEdit ? (
						<Dropdown.Item id="sandbox" textValue="Open in sandbox">
							<TbFlask size={16} />
							<Label>Open in sandbox</Label>
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
 * holds yet and leads back to the canvas, where it can be committed.
 */
export function VersionList({
	versions,
	uncommitted,
	selectedId,
	canEdit,
	onSelect,
	onOpenCanvas,
	onAction,
}: {
	versions: Version[];
	uncommitted: boolean;
	selectedId: string | undefined;
	canEdit: boolean;
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
						className="flex w-full items-center gap-2 border-b border-border px-4 py-3 text-left text-sm hover:bg-surface-secondary"
					>
						<span className="size-2 shrink-0 rounded-full bg-warning" />
						<span className="font-medium">Uncommitted changes</span>
						<span className="ml-auto text-xs text-muted">Open canvas</span>
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
							{version.isHead && (
								<span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">
									Current
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
						<VersionMenu version={version} canEdit={canEdit} onAction={onAction} />
					</div>
				</li>
			))}
		</ul>
	);
}
