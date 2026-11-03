import { Tooltip } from "@fluxify/components";
import { TbCircleCheck, TbRocket } from "react-icons/tb";
import type { SplitButtonItem } from "@/components/common/SplitButton";
import type { Version } from "@/services/versions";
import { deployAction } from "./VersionList";

/** The tooltip's words: Promote to prod, or Roll back for a version older than the live one. */
const promoteLabel = (version: Version, liveVersionNumber: number | null) =>
	deployAction(version, liveVersionNumber)?.label === "Promote to production"
		? "Promote to prod"
		: "Roll back to this version";

/**
 * One version as a row in the canvas's version menu (#1075). The live version is
 * green and has nothing to promote. Any other shows a rocket at its end on hover
 * or focus, and choosing the row, or the rocket, asks to promote it.
 */
export function versionMenuItem(
	version: Version,
	liveVersionNumber: number | null,
	onPromote: (version: Version) => void,
): SplitButtonItem {
	const label = promoteLabel(version, liveVersionNumber);
	return {
		id: `version:${version.id}`,
		label: `v${version.versionNumber} ${version.title}`,
		// green stays put: choosing the live version changes nothing, so the menu stays open
		className: version.isProd ? "bg-success/10 text-success" : undefined,
		closeOnAction: !version.isProd,
		onAction: () => {
			if (!version.isProd) onPromote(version);
		},
		children: (
			<>
				<span className="font-mono font-semibold">v{version.versionNumber}</span>
				<span className="min-w-0 flex-1 truncate">{version.title}</span>
				{version.isProd ? (
					<TbCircleCheck size={16} role="img" aria-label="In production" className="shrink-0" />
				) : (
					<Tooltip delay={200}>
						<Tooltip.Trigger
							render={(props) => (
								<span
									{...props}
									role="img"
									aria-label={label}
									className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-data-[focused=true]:opacity-100"
								/>
							)}
						>
							<TbRocket size={16} />
						</Tooltip.Trigger>
						<Tooltip.Content className="whitespace-nowrap">{label}</Tooltip.Content>
					</Tooltip>
				)}
			</>
		),
	};
}
