import { Button, Chip, DeleteButton } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { TbExternalLink, TbPencil } from "react-icons/tb";
import type { ClaimView } from "@/services/orchestration";
import { TYPE_LABEL } from "./copy";
import { NodeList } from "./NodeList";

/**
 * One claim with the nodes it produced.
 *
 * The claim is the unit on both surfaces, because it is the unit a person
 * thinks in: "this workload, this many copies". The nodes under it are its
 * consequence, not something to be managed one at a time — there are no
 * per-node buttons here on purpose.
 */
export function ClaimCard({
	claim,
	provider,
	showProject = false,
	onChange,
	onRelease,
}: {
	claim: ClaimView;
	provider: string | null;
	showProject?: boolean;
	onChange?: () => void;
	onRelease?: () => void;
}) {
	const serving = claim.nodes.filter((node) => node.serving).length;
	// Names come resolved from the status API (#423) — the instance surface
	// spans every project and has no group vocabulary of its own to guess with.
	const groups = claim.groups.map((group) => group.name);

	return (
		<section className="overflow-hidden rounded-xl border border-border bg-background">
			<header className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<h3 className="text-sm font-bold text-foreground">
							{TYPE_LABEL[claim.type] ?? claim.type}
						</h3>
						<Chip size="sm" color={serving === claim.replicas ? "success" : "warning"}>
							{serving} of {claim.replicas} serving
						</Chip>
						{showProject && (
							<span className="text-xs text-muted">{claim.projectId ?? "every project"}</span>
						)}
					</div>
					<p className="mt-1 text-xs text-muted">
						{claim.type === "route"
							? "Serves this project's APIs"
							: groups.length > 0
								? `Trigger groups: ${groups.join(", ")}`
								: "Every trigger group no other node claims"}
					</p>
					{/* A project's groups belong to that project, so they are read here
					    and edited there. The link is the whole affordance. */}
					{showProject && claim.projectId !== null && groups.length > 0 && (
						<Link
							to="/$projectId/settings"
							params={{ projectId: claim.projectId }}
							search={{ tab: "nodes" }}
							className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent underline underline-offset-2 hover:text-accent/80"
						>
							Edit these groups in the project's settings
							<TbExternalLink className="inline-block" size={12} />
						</Link>
					)}
				</div>

				{(onChange || onRelease) && (
					<div className="flex shrink-0 items-center gap-2">
						{onChange && (
							<Button size="sm" variant="outline" onPress={onChange}>
								<TbPencil size={15} />
								Change
							</Button>
						)}
						{onRelease && (
							<DeleteButton size="sm" onPress={onRelease}>
								Release
							</DeleteButton>
						)}
					</div>
				)}
			</header>

			<NodeList
				nodes={claim.nodes}
				provider={provider}
				showProject={showProject}
				empty="This claim has no nodes yet."
			/>
		</section>
	);
}
