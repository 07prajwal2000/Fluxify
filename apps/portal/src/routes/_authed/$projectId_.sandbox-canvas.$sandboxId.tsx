import { Button, toast } from "@fluxify/components";
import { createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { TbActivity, TbArrowLeft, TbSettings } from "react-icons/tb";
import z from "zod";
import { CanvasWorkbench } from "@/components/canvas";
import { RecordingsModal } from "@/components/recordings/ExecutionRecordings";
import { DevWorkerBanner } from "@/components/sandboxes/DevWorkerBanner";
import { SandboxPlayground } from "@/components/sandboxes/SandboxPlayground";
import { SandboxRunButton, SandboxRunModal } from "@/components/sandboxes/SandboxRunModal";
import { SandboxSettingsModal } from "@/components/sandboxes/SandboxSettingsModal";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { useProjectPackageTypes } from "@/query/projectPackagesQuery";
import { sandboxesQuery } from "@/query/sandboxesQuery";
import { sandboxCanvas, sandboxesService } from "@/services/sandboxes";
import { useCanEditProject } from "@/store/auth";

export const Route = createFileRoute("/_authed/$projectId_/sandbox-canvas/$sandboxId")({
	head: createRouteHead(
		"Sandbox Canvas | Sandboxes",
		"Try blocks on a private canvas and run them on development data.",
	),
	validateSearch: z.object({ block: z.string().optional(), error: z.string().optional() }),
	beforeLoad: async ({ params, context }) => {
		const notFound = () => {
			toast.danger("Sandbox not found");
			return redirect({ to: "/$projectId/sandboxes", params: { projectId: params.projectId } });
		};
		try {
			const sandbox = await context.queryClient.ensureQueryData({
				queryKey: ["sandboxes", params.projectId, params.sandboxId, "by-id"],
				queryFn: () => sandboxesService.getById(params.projectId, params.sandboxId),
			});
			if (!sandbox || sandbox.projectId !== params.projectId) throw notFound();
		} catch (err) {
			if (isRedirect(err)) throw err;
			throw notFound();
		}
	},
	component: SandboxCanvasPage,
});

function SandboxCanvasPage() {
	const { projectId, sandboxId } = Route.useParams();
	const { block, error } = Route.useSearch();
	const navigate = useNavigate();
	useProjectPackageTypes(projectId);
	const canEdit = useCanEditProject(projectId);
	const { data: sandbox } = sandboxesQuery.byId.useQuery(projectId, sandboxId);
	usePageTitle(sandbox?.name ? `${sandbox.name} | Sandboxes` : "Sandbox Canvas | Sandboxes");
	const save = sandboxesQuery.saveCanvas.mutation(projectId, sandboxId);
	const canvas = sandboxCanvas(projectId);
	// while it is still loading, assume it is up: no banner flashing on every open
	const { data: online = true } = sandboxesQuery.devWorker.useQuery(projectId);

	const [settingsOpen, setSettingsOpen] = useState(false);
	const [runOpen, setRunOpen] = useState(false);
	const [runsOpen, setRunsOpen] = useState(false);
	const [focusRun, setFocusRun] = useState<string | undefined>();
	const name = sandbox?.name ?? "Sandbox";

	return (
		<>
			<CanvasWorkbench
				title="Sandbox canvas"
				enableBlockPicker
				enablePlayground
				enableSpotlight
				focusBlock={block ? { blockId: block, error } : undefined}
				readOnly={!canEdit}
				items={sandboxesQuery.canvasItems.useQuery(projectId, sandboxId)}
				compileTarget={{ projectId, resourceType: "sandbox", resourceId: sandboxId }}
				reload={() => canvas.getCanvasItems(sandboxId)}
				getVersion={() => canvas.getCanvasVersion(sandboxId)}
				save={(payload) => save.mutateAsync(payload)}
				banner={<DevWorkerBanner online={online} />}
				playgroundContent={
					<SandboxPlayground
						key={sandboxId}
						projectId={projectId}
						sandboxId={sandboxId}
						online={online}
						onOpenRun={(runId) => {
							setFocusRun(runId);
							setRunsOpen(true);
						}}
					/>
				}
				headerLeft={
					<>
						<Button
							variant="ghost"
							aria-label="Back to sandboxes"
							onPress={() => navigate({ to: "/$projectId/sandboxes", params: { projectId } })}
						>
							<TbArrowLeft size={16} />
						</Button>
						<span className="font-medium">{name}</span>
						<span className="text-xs text-muted">Sandbox</span>
					</>
				}
				headerActions={
					<>
						<Button
							variant="outline"
							onPress={() => {
								setFocusRun(undefined);
								setRunsOpen(true);
							}}
						>
							<TbActivity size={16} /> Runs
						</Button>
						<SandboxRunButton
							projectId={projectId}
							online={online}
							onPress={() => setRunOpen(true)}
						/>
						<Button variant="outline" onPress={() => setSettingsOpen(true)}>
							<TbSettings size={16} /> Settings
						</Button>
					</>
				}
			/>
			{/* mounted only while open: each form seeds its state from the loaded sandbox */}
			{settingsOpen && (
				<SandboxSettingsModal
					projectId={projectId}
					sandboxId={sandboxId}
					isOpen={settingsOpen}
					onOpenChange={setSettingsOpen}
				/>
			)}
			{runOpen && (
				<SandboxRunModal
					projectId={projectId}
					sandboxId={sandboxId}
					name={name}
					online={online}
					isOpen={runOpen}
					onOpenChange={setRunOpen}
				/>
			)}
			{runsOpen && (
				<RecordingsModal
					key={focusRun ?? "list"}
					projectId={projectId}
					target={{ type: "sandbox", id: sandboxId }}
					emptyHint="send a request from the playground, or press Run"
					initialRunId={focusRun}
					isOpen={runsOpen}
					onOpenChange={setRunsOpen}
				/>
			)}
		</>
	);
}
