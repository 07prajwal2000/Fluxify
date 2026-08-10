import { useAiHarnessStore } from "@/store/aiHarness";
import { TbChevronsRight } from "react-icons/tb";
import { RouteArtifact } from "./artifacts/RouteArtifact";
import { CanvasArtifact } from "./artifacts/CanvasArtifact";

export function ArtifactsSidebar() {
	const selectedArtifact = useAiHarnessStore((s) => s.selectedArtifact);
	const setSelectedArtifact = useAiHarnessStore((s) => s.setSelectedArtifact);

	return (
		<div 
			className={`h-full border-l border-white/10 bg-surface transition-all duration-300 ease-in-out shrink-0 overflow-hidden ${
				selectedArtifact ? 'w-[500px] opacity-100' : 'w-0 opacity-0 border-none'
			}`}
		>
			<div className="w-[500px] h-full flex flex-col relative">
				<div className="h-14 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
					<h3 className="font-semibold text-foreground">Artifacts</h3>
					<button 
						onClick={() => setSelectedArtifact(null)} 
						className="p-1 hover:bg-white/10 rounded-md text-muted hover:text-foreground transition-colors"
					>
						<TbChevronsRight size={20} />
					</button>
				</div>
				
				<div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
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
								<pre className="text-xs text-muted bg-black/20 p-3 rounded-lg overflow-x-auto mt-1 border border-white/5 custom-scrollbar">
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
