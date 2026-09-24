import { Spinner } from "@fluxify/components";
import { TbAlertTriangle, TbCheck } from "react-icons/tb";
import { projectPackagesQuery } from "@/query/projectPackagesQuery";

/** Where each live worker got with the project's current packages; polls until settled. */
export function PackagesRollout({ projectId }: { projectId: string }) {
	const { data } = projectPackagesQuery.status.useQuery(projectId);
	if (!data || data.version === 0) return null;
	const problems = data.nodes.filter(
		(n) => n.status?.state === "failed" || n.status?.failedImports?.length,
	);
	if (data.done && !problems.length) {
		return (
			<p className="flex items-center gap-2 text-sm text-success">
				<TbCheck size={16} /> Installed on every worker ({data.nodes.length})
			</p>
		);
	}

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-secondary p-4">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				{!data.done && <Spinner size="sm" />}
				{data.done ? "Rollout finished with problems" : "Installing on workers…"}
			</div>
			{data.nodes.map((node) => (
				<div key={node.nodeId} className="flex flex-col gap-1 text-xs">
					<div className="flex items-center justify-between">
						<span className="font-mono text-muted">
							{node.type} · {node.nodeId.slice(0, 8)}
						</span>
						<NodeState status={node.status} version={data.version} />
					</div>
					{node.status?.error && <p className="text-danger">{node.status.error}</p>}
					{node.status?.failedImports?.map((f) => (
						<p key={f.name} className="flex items-center gap-1 text-warning">
							<TbAlertTriangle size={14} /> {f.name} failed to load: {f.error}
						</p>
					))}
				</div>
			))}
		</div>
	);
}

function NodeState({
	status,
	version,
}: {
	status: { version: number; state: string } | null;
	version: number;
}) {
	if (!status || status.version < version) return <span className="text-muted">waiting</span>;
	if (status.state === "ready") return <span className="text-success">ready</span>;
	if (status.state === "failed") return <span className="text-danger">failed</span>;
	return <span className="text-muted">installing</span>;
}
