import { Link } from "@tanstack/react-router";
import { TbExternalLink } from "react-icons/tb";

/** Explains the relationship between the route switch and project destinations. */
export function RouteTelemetryHelp({ projectId }: { projectId: string }) {
	return (
		<p className="text-xs text-muted">
			Enabling telemetry collects a request trace. Fluxify exports it only to
			destinations configured for this project: with one traces or metrics
			destination, it exports only that signal; with both, it exports both. Logs
			are configured separately and are not affected by this setting. {" "}
			<Link
				to="/$projectId/settings"
				params={{ projectId }}
				search={{ tab: "telemetry" }}
				target="_blank"
				rel="noreferrer"
				aria-label="Configure telemetry destinations (opens in a new tab)"
				className="font-medium text-accent underline underline-offset-2 hover:text-accent/80"
			>
				Configure telemetry destinations <TbExternalLink className="inline-block align-text-bottom" size={13} />
			</Link>
			.
		</p>
	);
}
