import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { ApplyBar } from "./ApplyBar";
import { CanvasPreview } from "./CanvasPreview";
import {
	useArtifactParams,
	useBlockingParent,
	useCanvasArtifact,
} from "./useArtifact";

export function CanvasArtifact({ subArtifactId }: { subArtifactId: string }) {
	const { projectId, conversationId } = useArtifactParams();

	const { data: detail, isLoading } =
		harnessConversationsQuery.subArtifacts.useDetailQuery(
			projectId,
			conversationId,
			subArtifactId,
		);
	const { graph, route, routeId, routeExists, targetsRoute } =
		useCanvasArtifact(detail);
	const blockingParent = useBlockingParent(detail);

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

			{/* A sibling that has not been applied yet is the ApplyBar's business —
			    it names the output and offers a way in. This warning is for the
			    other case: a route from an earlier run that is simply gone. */}
			{routeExists || blockingParent || !targetsRoute ? (
				<ApplyBar
					subArtifactId={detail.id}
					appliedAt={detail.appliedAt}
					routeId={routeId || undefined}
					blockedBy={blockingParent}
				/>
			) : (
				<div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
					<p className="text-xs text-foreground">
						These changes hang off a route that doesn't exist yet. Create the route
						first, then come back and apply them.
					</p>
				</div>
			)}
		</div>
	);
}
