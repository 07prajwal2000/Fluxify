import { useEffect, useMemo } from "react";
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
import { Button, Spinner } from "@fluxify/components";
import { TbArrowLeft } from "react-icons/tb";
import { routesQuery } from "@/query/routesQuery";
import { GenericBlockNode } from "@/components/editor/GenericBlockNode";
import { blocksList } from "@/components/editor/blocks/nodes";

export const Route = createFileRoute("/_authed/$projectId_/editor/$routeId")({
	component: EditorPage,
});

// Ported per-type node when available; generic node for types not yet ported.
const nodeTypes = new Proxy(
	{},
	{ get: (_t, key: string) => blocksList[key] ?? GenericBlockNode },
) as Record<string, typeof GenericBlockNode>;

function EditorPage() {
	const { projectId, routeId } = Route.useParams();
	const navigate = useNavigate();
	const { data, isLoading, isError } = routesQuery.canvasItems.useQuery(routeId);

	const { initialNodes, initialEdges } = useMemo(() => {
		const blocks = data?.blocks ?? [];
		const rawEdges = data?.edges ?? [];
		// Collect the handle IDs each block actually uses, from its edges.
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
	}, [data]);

	return (
		<div className="flex h-screen w-screen flex-col bg-background text-foreground">
			<header className="flex items-center gap-3 border-b border-border px-4 py-2">
				<Button
					variant="ghost"
					onPress={() =>
						navigate({ to: "/$projectId/routes", params: { projectId } })
					}
				>
					<TbArrowLeft size={16} /> Routes
				</Button>
				<span className="text-sm text-muted">Editor</span>
			</header>

			<div className="relative min-h-0 flex-1">
				{isLoading ? (
					<div className="flex h-full items-center justify-center">
						<Spinner />
					</div>
				) : isError ? (
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

	// canvas-items load async; sync once when they arrive
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
