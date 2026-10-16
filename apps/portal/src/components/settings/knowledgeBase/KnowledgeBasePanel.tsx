import { Button, Spinner } from "@fluxify/components";
import { useEffect } from "react";
import { TbBook, TbPlus } from "react-icons/tb";
import { SplitPane } from "@/components/common/SplitPane";
import { knowledgeSourcesQuery } from "@/query/knowledgeSourcesQuery";
import { useCanEditProject } from "@/store/auth";
import { AddKnowledgeSourcePane } from "./AddKnowledgeSourcePane";
import { KnowledgeSourceDetailPane } from "./KnowledgeSourceDetailPane";
import { KnowledgeSourceSidebar } from "./KnowledgeSourceSidebar";

interface KnowledgeBasePanelProps {
	projectId: string;
	selectedSourceId: string | null;
	isAdding: boolean;
	onSelectSource: (id: string | null) => void;
	onSetIsAdding: (isAdding: boolean) => void;
}

export function KnowledgeBasePanel({
	projectId,
	selectedSourceId,
	isAdding,
	onSelectSource,
	onSetIsAdding,
}: KnowledgeBasePanelProps) {
	const { data: sources = [], isLoading } = knowledgeSourcesQuery.getAll.useQuery(projectId);
	const canEdit = useCanEditProject(projectId);

	// If a source is deleted or not in list, clear selection immediately
	useEffect(() => {
		if (selectedSourceId && !sources.some((s) => s.id === selectedSourceId)) {
			onSelectSource(null);
		}
	}, [selectedSourceId, sources, onSelectSource]);

	if (isLoading) {
		return (
			<div className="flex h-96 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	const leftPane = (
		<KnowledgeSourceSidebar
			sources={sources}
			selectedSourceId={selectedSourceId}
			isAdding={isAdding}
			canEdit={canEdit}
			onSelectSource={(id) => {
				onSetIsAdding(false);
				onSelectSource(id);
			}}
			onAddSource={() => {
				onSetIsAdding(true);
				onSelectSource(null);
			}}
		/>
	);

	const rightPane = (
		<div className="flex h-full min-h-0 w-full flex-col bg-surface">
			{isAdding ? (
				<AddKnowledgeSourcePane
					projectId={projectId}
					onCreated={(newId) => {
						onSetIsAdding(false);
						onSelectSource(newId);
					}}
					onCancel={() => {
						onSetIsAdding(false);
						onSelectSource(null);
					}}
				/>
			) : selectedSourceId && sources.some((s) => s.id === selectedSourceId) ? (
				<KnowledgeSourceDetailPane
					key={selectedSourceId}
					projectId={projectId}
					sourceId={selectedSourceId}
					canEdit={canEdit}
					onDeleted={() => {
						onSelectSource(null);
					}}
				/>
			) : (
				<div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
					<div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary text-muted">
						<TbBook size={24} />
					</div>
					<div>
						<h3 className="font-medium text-foreground">No source selected</h3>
						<p className="text-xs text-muted max-w-sm mt-1">
							Select a knowledge source from the sidebar to inspect its settings and indexed
							content.
						</p>
					</div>
					{canEdit && (
						<Button
							variant="primary"
							size="sm"
							onPress={() => {
								onSetIsAdding(true);
								onSelectSource(null);
							}}
						>
							<TbPlus size={14} className="mr-1.5" /> Add source
						</Button>
					)}
				</div>
			)}
		</div>
	);

	return (
		<div className="flex h-full min-h-0 flex-1 w-full overflow-hidden rounded-xl border border-border bg-surface">
			<SplitPane left={leftPane} right={rightPane} initial={30} min={22} max={45} />
		</div>
	);
}
