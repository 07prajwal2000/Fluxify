import { TbBox, TbTrash } from "react-icons/tb";
import type { ToolPart } from "../agentMessages";
import { isRec, rec, str } from "./data";
import { Notice } from "./Notice";

/** Previews package operations: install_package, remove_package. */
export function PackagePreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const input = rec(tool.input);
	const isRemove = tool.name === "remove_package";

	if (isRemove) {
		const names = Array.isArray(input.names) ? input.names.map(str) : [];
		return (
			<section
				aria-label="Remove packages"
				className="flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs"
			>
				<header className="flex items-center gap-2">
					<TbTrash size={16} className="shrink-0 text-danger" />
					<span className="font-medium text-danger">
						Uninstall package{names.length > 1 ? "s" : ""}
					</span>
				</header>
				<div className="flex flex-wrap gap-1 font-mono">
					{names.map((n) => (
						<span
							key={n}
							className="rounded border border-danger/30 bg-surface px-1.5 py-0.5 text-foreground"
						>
							{n}
						</span>
					))}
				</div>
				{asking && <p className="text-danger">Code that imports these packages will fail.</p>}
			</section>
		);
	}

	const pkgs: { name: string; version?: string }[] = Array.isArray(input.packages)
		? input.packages.map((p: any) => ({
				name: str(p?.name),
				version: str(p?.version) || undefined,
			}))
		: isRec(input.packages)
			? Object.entries(input.packages).map(([k, v]) => ({ name: k, version: str(v) || undefined }))
			: [];

	return (
		<div className="flex flex-col gap-2 text-xs">
			<header className="flex items-center gap-2 text-sm">
				<TbBox size={16} className="shrink-0 text-muted" />
				<span className="font-medium text-foreground">
					Install package{pkgs.length > 1 ? "s" : ""}
				</span>
			</header>
			{asking && (
				<Notice tone="warning">
					This action will install {pkgs.length} package{pkgs.length === 1 ? "" : "s"} from the npm
					registry.
				</Notice>
			)}
			<div className="flex flex-wrap gap-1.5 font-mono">
				{pkgs.map((p) => (
					<span
						key={p.name}
						className="rounded border border-border bg-surface px-1.5 py-0.5 text-foreground"
					>
						{p.name}
						{p.version && <span className="text-muted">@{p.version}</span>}
					</span>
				))}
			</div>
		</div>
	);
}
