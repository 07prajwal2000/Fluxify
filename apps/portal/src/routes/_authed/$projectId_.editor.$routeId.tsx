import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	addEdge,
	Background,
	Controls,
	Panel,
	ReactFlow,
	ReactFlowProvider,
	useEdgesState,
	useNodesState,
	useReactFlow,
	type Connection,
	type Edge,
	type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button, Spinner, Switch, toast } from "@fluxify/components";
import { TbArrowLeft, TbPlus } from "react-icons/tb";
import { routesQuery } from "@/query/routesQuery";
import type { CanvasSavePayload } from "@/services/routes";
import { showErrorNotification } from "@/lib/errorNotifier";
import { GenericBlockNode } from "@/components/editor/GenericBlockNode";
import { blocksList } from "@/components/editor/blocks/nodes";
import { BlockPalette } from "@/components/editor/BlockPalette";

export const Route = createFileRoute("/_authed/$projectId_/editor/$routeId")({
	component: EditorPage,
});

const nodeTypes = new Proxy(
	{},
	{ get: (_t, key: string) => blocksList[key] ?? GenericBlockNode },
) as Record<string, typeof GenericBlockNode>;

const TABS = ["editor", "executions", "testing"] as const;
type Tab = (typeof TABS)[number];

// strip UI-only handle hints before persisting
function cleanData(data: Record<string, unknown>) {
	const { sources: _s, targets: _t, ...rest } = data;
	return rest;
}

function EditorPage() {
	const { projectId, routeId } = Route.useParams();
	const navigate = useNavigate();
	const [tab, setTab] = useState<Tab>("editor");

	const { data: route } = routesQuery.byId.useQuery(routeId);
	const canvas = routesQuery.canvasItems.useQuery(routeId);
	const toggle = routesQuery.toggleActive.mutation();
	const save = routesQuery.saveCanvas.mutation(routeId);

	const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
	const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
	const [dirty, setDirty] = useState(false);
	const initialIds = useRef({ blocks: new Set<string>(), edges: new Set<string>() });

	// Load canvas items into state once they arrive.
	useEffect(() => {
		if (!canvas.data) return;
		const rawEdges = canvas.data.edges;
		const sourcesByNode: Record<string, Set<string>> = {};
		const targetsByNode: Record<string, Set<string>> = {};
		for (const e of rawEdges) {
			(sourcesByNode[e.from] ??= new Set()).add(e.fromHandle);
			(targetsByNode[e.to] ??= new Set()).add(e.toHandle);
		}
		setNodes(
			canvas.data.blocks.map((b) => ({
				id: b.id,
				type: b.type,
				position: b.position,
				data: {
					...((b.data ?? {}) as Record<string, unknown>),
					sources: [...(sourcesByNode[b.id] ?? [])],
					targets: [...(targetsByNode[b.id] ?? [])],
				},
			})),
		);
		setEdges(
			rawEdges.map((e) => ({
				id: e.id,
				source: e.from,
				target: e.to,
				sourceHandle: e.fromHandle,
				targetHandle: e.toHandle,
			})),
		);
		initialIds.current = {
			blocks: new Set(canvas.data.blocks.map((b) => b.id)),
			edges: new Set(rawEdges.map((e) => e.id)),
		};
		setDirty(false);
	}, [canvas.data, setNodes, setEdges]);

	function onSave() {
		const currentBlockIds = new Set(nodes.map((n) => n.id));
		const currentEdgeIds = new Set(edges.map((e) => e.id));
		const payload: CanvasSavePayload = {
			actionsToPerform: {
				blocks: [
					...nodes.map((n) => ({ id: n.id, action: "upsert" as const })),
					...[...initialIds.current.blocks]
						.filter((id) => !currentBlockIds.has(id))
						.map((id) => ({ id, action: "delete" as const })),
				],
				edges: [
					...edges.map((e) => ({ id: e.id, action: "upsert" as const })),
					...[...initialIds.current.edges]
						.filter((id) => !currentEdgeIds.has(id))
						.map((id) => ({ id, action: "delete" as const })),
				],
			},
			changes: {
				blocks: nodes.map((n) => ({
					id: n.id,
					type: n.type ?? "",
					data: cleanData(n.data as Record<string, unknown>),
					position: n.position,
				})),
				edges: edges.map((e) => ({
					id: e.id,
					from: e.source,
					to: e.target,
					fromHandle: e.sourceHandle ?? "",
					toHandle: e.targetHandle ?? "",
				})),
			},
		};
		save.mutate(payload, {
			onSuccess: () => {
				toast.success("Flow saved");
				setDirty(false);
			},
			onError: (e) => showErrorNotification(e as Error),
		});
	}

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
					<Button
						variant="primary"
						isDisabled={!dirty}
						isPending={save.isPending}
						onPress={onSave}
					>
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
						<Flow
							nodes={nodes}
							edges={edges}
							onNodesChange={onNodesChange}
							onEdgesChange={onEdgesChange}
							setNodes={setNodes}
							setEdges={setEdges}
							markDirty={() => setDirty(true)}
						/>
					</ReactFlowProvider>
				)}
			</div>
		</div>
	);
}

type FlowProps = {
	nodes: Node[];
	edges: Edge[];
	onNodesChange: Parameters<typeof ReactFlow>[0]["onNodesChange"];
	onEdgesChange: Parameters<typeof ReactFlow>[0]["onEdgesChange"];
	setNodes: ReturnType<typeof useNodesState<Node>>[1];
	setEdges: ReturnType<typeof useEdgesState<Edge>>[1];
	markDirty: () => void;
};

function Flow({ nodes, edges, onNodesChange, onEdgesChange, setNodes, setEdges, markDirty }: FlowProps) {
	const [paletteOpen, setPaletteOpen] = useState(false);
	const { screenToFlowPosition } = useReactFlow();

	function addBlock(type: string) {
		const position = screenToFlowPosition({
			x: window.innerWidth / 2,
			y: window.innerHeight / 2,
		});
		setNodes((n) => [
			...n,
			{ id: crypto.randomUUID(), type, position, data: { sources: [], targets: [] } },
		]);
		setPaletteOpen(false);
		markDirty();
		toast.success("Block added");
	}

	function onConnect(conn: Connection) {
		setEdges((e) => addEdge(conn, e));
		markDirty();
	}

	return (
		<>
			<ReactFlow
				nodes={nodes}
				edges={edges}
				onNodesChange={(c) => {
					onNodesChange?.(c);
					if (c.some((ch) => ch.type !== "select" && ch.type !== "dimensions"))
						markDirty();
				}}
				onEdgesChange={(c) => {
					onEdgesChange?.(c);
					if (c.some((ch) => ch.type !== "select")) markDirty();
				}}
				onConnect={onConnect}
				nodeTypes={nodeTypes}
				fitView
				proOptions={{ hideAttribution: true }}
			>
				<Background />
				<Controls />
				<Panel position="top-right">
					<Button
						isIconOnly
						variant="primary"
						aria-label="Add block"
						onPress={() => setPaletteOpen(true)}
					>
						<TbPlus size={18} />
					</Button>
				</Panel>
			</ReactFlow>
			<BlockPalette
				open={paletteOpen}
				onClose={() => setPaletteOpen(false)}
				onAdd={addBlock}
			/>
		</>
	);
}
