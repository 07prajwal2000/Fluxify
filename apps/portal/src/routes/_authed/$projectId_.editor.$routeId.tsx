import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Background,
	Controls,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	type Edge,
	type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Spinner, Switch, toast } from "@fluxify/components";
import { TbArrowLeft } from "react-icons/tb";
import { routesQuery } from "@/query/routesQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { GenericBlockNode } from "@/components/editor/GenericBlockNode";
import { blocksList } from "@/components/editor/blocks/nodes";

export const Route = createFileRoute("/_authed/$projectId_/editor/$routeId")({
	component: EditorPage,
});

const nodeTypes = new Proxy(
	{},
	{ get: (_t, key: string) => blocksList[key] ?? GenericBlockNode },
) as Record<string, typeof GenericBlockNode>;

const TABS = ["editor", "executions", "testing"] as const;
type Tab = (typeof TABS)[number];

function EditorPage() {
	const { projectId, routeId } = Route.useParams();
	const navigate = useNavigate();
	const [tab, setTab] = useState<Tab>("editor");

	const { data: route } = routesQuery.byId.useQuery(routeId);
	const canvas = routesQuery.canvasItems.useQuery(routeId);
	const toggle = routesQuery.toggleActive.mutation();

	const { initialNodes, initialEdges } = useMemo(() => {
		const blocks = canvas.data?.blocks ?? [];
		const rawEdges = canvas.data?.edges ?? [];
		const sourcesByNode: Record<string, Set<string>> = {};
		const targetsByNode: Record<string, Set<string>> = {};
		for (const e of rawEdges) {
			(sourcesByNode[e.from] ??= new Set()).add(e.fromHandle);
			(targetsByNode[e.to] ??= new Set()).add(e.toHandle);
		}
		const initialNodes: Node[] = blocks.map((b) => ({
			id: b.id,
			type: b.type,
			position: b.position,
			data: {
				...((b.data ?? {}) as Record<string, unknown>),
				sources: [...(sourcesByNode[b.id] ?? [])],
				targets: [...(targetsByNode[b.id] ?? [])],
			},
		}));
		const initialEdges: Edge[] = rawEdges.map((e) => ({
			id: e.id,
			source: e.from,
			target: e.to,
			sourceHandle: e.fromHandle,
			targetHandle: e.toHandle,
		}));
		return { initialNodes, initialEdges };
	}, [canvas.data]);

	return (
		<div className="flex h-screen w-screen flex-col bg-background text-foreground">
			<header className="relative flex items-center justify-between border-b border-border px-4 py-2">
				<div className="flex items-center gap-3">
					<Button
						variant="ghost"
						onPress={() =>
							navigate({ to: "/$projectId/routes", params: { projectId } })
						}
					>
						<TbArrowLeft size={16} />
					</Button>
					<span className="font-medium">{route?.name ?? "Editor"}</span>
					{route?.method && (
						<span className="rounded bg-background-secondary px-1.5 py-0.5 font-mono text-xs text-muted">
							{route.method} {route.path}
						</span>
					)}
				</div>

				{/* centered tab switcher */}
				<div className="absolute left-1/2 flex -translate-x-1/2 gap-1 rounded-md border border-border p-1">
					{TABS.map((t) => (
						<Button
							key={t}
							variant={tab === t ? "primary" : "ghost"}
							onPress={() => setTab(t)}
						>
							{t[0].toUpperCase() + t.slice(1)}
						</Button>
					))}
				</div>

				<div className="flex items-center gap-4">
					{route && (
						<Switch
							isSelected={route.active}
							onChange={(active) =>
								toggle.mutate(
									{ id: routeId, active },
									{
										onSuccess: () =>
											toast.success(active ? "Route enabled" : "Route disabled"),
										onError: (e) => showErrorNotification(e as Error),
									},
								)
							}
						>
							{route.active ? "Active" : "Inactive"}
						</Switch>
					)}
					{/* ponytail: Save needs the change-tracker (diff payload) — next stage */}
					<Button variant="outline" isDisabled>
						Save
					</Button>
				</div>
			</header>

			<div className="relative min-h-0 flex-1">
				{tab !== "editor" ? (
					<div className="flex h-full items-center justify-center text-muted">
						{tab === "executions" ? "Executions" : "Testing"} panel — coming soon.
					</div>
				) : canvas.isLoading ? (
					<div className="flex h-full items-center justify-center">
						<Spinner />
					</div>
				) : canvas.isError ? (
					<div className="flex h-full items-center justify-center text-muted">
						Couldn't load the flow.
					</div>
				) : (
					<ReactFlowProvider>
						<Canvas nodes={initialNodes} edges={initialEdges} />
					</ReactFlowProvider>
				)}
			</div>
		</div>
	);
}

function Canvas({ nodes: initN, edges: initE }: { nodes: Node[]; edges: Edge[] }) {
	const [nodes, setNodes, onNodesChange] = useNodesState(initN);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initE);

	useEffect(() => {
		setNodes(initN);
		setEdges(initE);
	}, [initN, initE, setNodes, setEdges]);

	return (
		<ReactFlow
			nodes={nodes}
			edges={edges}
			onNodesChange={onNodesChange}
			onEdgesChange={onEdgesChange}
			nodeTypes={nodeTypes}
			fitView
			proOptions={{ hideAttribution: true }}
		>
			<Background />
			<Controls />
		</ReactFlow>
	);
}
