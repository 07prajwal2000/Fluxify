import { Button } from "@fluxify/components";
import { TbArrowRight } from "react-icons/tb";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { useAiHarnessStore } from "@/store/aiHarness";
import { ApplyBar } from "./ApplyBar";
import { CanvasPreview } from "./CanvasPreview";
import { useArtifactParams, useCanvasArtifact } from "./useArtifact";

export function CanvasArtifact({ subArtifactId }: { subArtifactId: string }) {
	const { projectId, conversationId } = useArtifactParams();
	const setSelectedArtifact = useAiHarnessStore((s) => s.setSelectedArtifact);

	const { data: detail, isLoading } =
		harnessConversationsQuery.subArtifacts.useDetailQuery(
			projectId,
			conversationId,
			subArtifactId,
		);
	const { graph, route, routeId, routeExists, blockingRoute } =
		useCanvasArtifact(detail);

	if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
	if (!detail) return <p className="text-sm text-muted">Not found.</p>;

	return (
		<div className="flex flex-col gap-4">
			<div>
				<span className="text-[10px] text-muted uppercase font-bold tracking-wider">
					Target
				</span>
				<p className="text-sm mt-1 text-foreground">
					{route ? `${route.method} ${route.path}` : "New route from this run"}
				</p>
			</div>

			<CanvasPreview graph={graph} title="Proposed canvas" />
			<p className="text-xs text-muted">
				{graph.blocks.length} blocks · {graph.edges.length} connections
			</p>

			{routeExists ? (
				<ApplyBar
					subArtifactId={detail.id}
					appliedAt={detail.appliedAt}
					routeId={routeId || undefined}
					target="canvas"
				/>
			) : (
				<div className="rounded-lg border border-warning/30 bg-warning/10 p-3 flex flex-col gap-2">
					<p className="text-xs text-foreground">
						These changes hang off a route that doesn't exist yet. Create the route
						first, then come back and apply them.
					</p>
					{blockingRoute && (
						<Button
							size="sm"
							className="self-start flex items-center gap-2 cursor-pointer"
							onPress={() =>
								setSelectedArtifact({
									id: blockingRoute.id,
									type: "Route changes",
									props: {},
								})
							}
						>
							Open route settings <TbArrowRight size={14} />
						</Button>
					)}
				</div>
			)}
		</div>
	);
}
