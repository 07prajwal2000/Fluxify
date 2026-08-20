import { useAiHarnessStore } from "@/store/aiHarness";
import { TbCheck, TbChevronRight, TbChevronsRight } from "react-icons/tb";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { RouteArtifact } from "./artifacts/RouteArtifact";
import { CanvasArtifact } from "./artifacts/CanvasArtifact";
import { CustomBlockArtifact } from "./artifacts/CustomBlockArtifact";
import {
	artifactTypeForKind,
	kindLabel,
	useArtifactParams,
	useDependencyChain,
} from "./artifacts/useArtifact";

/**
 * What this output is waiting on, oldest ancestor first.
 *
 * A run's outputs are not a flat list — a route can invoke a custom block built
 * beside it, and applying them out of order produces something that cannot run.
 * Showing the chain turns "this is blocked" into "apply these, in this order".
 */
function DependencyChain({ subArtifactId }: { subArtifactId: string }) {
	const { projectId, conversationId } = useArtifactParams();
	const setSelectedArtifact = useAiHarnessStore((s) => s.setSelectedArtifact);
	const { data: detail } = harnessConversationsQuery.subArtifacts.useDetailQuery(
		projectId,
		conversationId,
		subArtifactId,
	);
	const chain = useDependencyChain(detail);
	if (chain.length === 0) return null;

	return (
		<nav className="flex items-center gap-1 flex-wrap mb-4 text-xs">
			{chain.map((parent) => (
				<span key={parent.id} className="flex items-center gap-1">
					<button
						type="button"
						onClick={() =>
							setSelectedArtifact({
								id: parent.id,
								type: artifactTypeForKind(parent.kind),
								props: {},
							})
						}
						className="flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-surface-secondary text-muted hover:text-foreground cursor-pointer"
					>
						{parent.appliedAt && <TbCheck size={12} className="text-success" />}
						{kindLabel(parent.kind)}
					</button>
					<TbChevronRight size={12} className="text-muted" />
				</span>
			))}
			<span className="px-2 py-1 text-foreground">this output</span>
		</nav>
	);
}

export function ArtifactsSidebar() {
	const selectedArtifact = useAiHarnessStore((s) => s.selectedArtifact);
	const setSelectedArtifact = useAiHarnessStore((s) => s.setSelectedArtifact);

	return (
		// `relative z-10`: the chat column's composer is `position: sticky`, and a
		// positioned box paints above a non-positioned sibling however late that
		// sibling comes in the DOM — the send button showed through this panel.
		<div
			className={`relative z-10 h-full border-l border-border bg-surface transition-all duration-300 ease-in-out shrink-0 overflow-hidden ${
				selectedArtifact ? 'w-[500px] opacity-100' : 'w-0 opacity-0 border-none'
			}`}
		>
			<div className="w-[500px] h-full flex flex-col relative">
				<div className="h-14 flex items-center justify-between px-4 border-b border-border shrink-0">
					<h3 className="font-semibold text-foreground">Artifacts</h3>
					<button 
						onClick={() => setSelectedArtifact(null)} 
						className="p-1 hover:bg-surface-secondary rounded-md text-muted hover:text-foreground transition-colors"
					>
						<TbChevronsRight size={20} />
					</button>
				</div>
				
				<div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
					{selectedArtifact && <DependencyChain subArtifactId={selectedArtifact.id} />}
					{selectedArtifact?.type.startsWith("Route ") ? (
						<RouteArtifact
							key={selectedArtifact.id}
							subArtifactId={selectedArtifact.id}
						/>
					) : selectedArtifact?.type.startsWith("Canvas Changes") ? (
						<CanvasArtifact
							key={selectedArtifact.id}
							subArtifactId={selectedArtifact.id}
						/>
					) : selectedArtifact?.type.startsWith("Custom Block ") ? (
						<CustomBlockArtifact key={selectedArtifact.id} subArtifactId={selectedArtifact.id} />
					) : (selectedArtifact && (
						<div className="flex flex-col gap-5">
							<div>
								<span className="text-[10px] text-muted uppercase font-bold tracking-wider">ID</span>
								<p className="text-sm font-medium mt-1 text-foreground">{selectedArtifact.id || "N/A"}</p>
							</div>
							
							<div>
								<span className="text-[10px] text-muted uppercase font-bold tracking-wider">Type</span>
								<p className="text-sm font-medium mt-1 capitalize text-foreground">{selectedArtifact.type}</p>
							</div>
							
							<div>
								<span className="text-[10px] text-muted uppercase font-bold tracking-wider">Props</span>
								<pre className="text-xs text-muted bg-surface-secondary p-3 rounded-lg overflow-x-auto mt-1 border border-border custom-scrollbar">
									{JSON.stringify(selectedArtifact.props, null, 2)}
								</pre>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
