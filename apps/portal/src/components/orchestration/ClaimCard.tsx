import { Button, Chip } from "@fluxify/components";
import { TbPencil } from "react-icons/tb";
import { DeleteButton } from "@fluxify/components";
import type { ClaimView } from "@/services/orchestration";
import { NodeList } from "./NodeList";
import { TYPE_LABEL } from "./copy";

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
	groupNames,
	showProject = false,
	onChange,
	onRelease,
}: {
	claim: ClaimView;
	provider: string | null;
	/** Group id → name, so a claim reads in the words the project uses. */
	groupNames?: Record<string, string>;
	showProject?: boolean;
	onChange?: () => void;
	onRelease?: () => void;
}) {
	const serving = claim.nodes.filter((node) => node.serving).length;
	const groups = claim.groupIds.map((id) => groupNames?.[id] ?? id);

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
							<span className="text-xs text-muted">
								{claim.projectId ?? "every project"}
							</span>
						)}
					</div>
					<p className="mt-1 text-xs text-muted">
						{claim.type === "route"
							? "Serves this project's APIs"
							: groups.length > 0
								? `Trigger groups: ${groups.join(", ")}`
								: "Every trigger group no other node claims"}
					</p>
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
