import { Spinner } from "@fluxify/components";
import { TbAlertTriangle, TbCheck } from "react-icons/tb";
import { pluginsQuery } from "@/query/pluginsQuery";
import type { PluginInstallStatus as Status } from "@/services/plugins";

type Node = Status["nodes"][number];

/** Where each live worker got installing this plugin's version; polls until settled. */
export function PluginInstallStatus({ projectId, name }: { projectId: string; name: string }) {
	const { data } = pluginsQuery.installStatus.useQuery(projectId, name);
	if (!data) return <Spinner size="sm" />;
	if (!data.nodes.length)
		return (
			<p className="text-sm text-muted">No worker runs this plugin in an enabled environment.</p>
		);

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-secondary p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				{data.done ? (
					<>
						<TbCheck size={16} className="text-success" /> Installed on every worker (
						{data.nodes.length})
					</>
				) : data.failed ? (
					<>
						<TbAlertTriangle size={16} className="text-danger" /> Install failed on a worker
					</>
				) : (
					<>
						<Spinner size="sm" /> Installing on workers…
					</>
				)}
			</div>
			{data.nodes.map((node) => (
				<NodeRow key={`${node.env}-${node.nodeId}`} node={node} version={data.version} />
			))}
		</div>
	);
}

function NodeRow({ node, version }: { node: Node; version: string }) {
	const { status } = node;
	const state =
		!status || status.version !== version
			? "waiting"
			: status.state === "ready"
				? "ready"
				: status.state === "error"
					? "failed"
					: "installing";
	const tone =
		state === "ready" ? "text-success" : state === "failed" ? "text-danger" : "text-muted";
	return (
		<div className="flex flex-col gap-1 text-xs">
			<div className="flex items-center justify-between">
				<span className="font-mono text-muted">
					{node.env} · {node.type} · {node.nodeId.slice(0, 8)}
				</span>
				<span className={tone}>{state}</span>
			</div>
			{status?.error && <p className="text-danger">{status.error}</p>}
			{status?.failedImports?.map((f) => (
				<p key={f.name} className="flex items-center gap-1 text-warning">
					<TbAlertTriangle size={14} /> {f.name} failed to load: {f.error}
				</p>
			))}
		</div>
	);
}
