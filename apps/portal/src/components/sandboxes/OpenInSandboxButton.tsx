import { Button, toast } from "@fluxify/components";
import { useState } from "react";
import { TbFlask } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import { routesQuery } from "@/query/routesQuery";
import type { CanvasItems } from "@/services/canvas";
import { useCanEditProject } from "@/store/auth";
import { copyWarnings, openInSandbox, type SandboxSource } from "./openInSandbox";

const hasSchema = (schema: unknown) =>
	!!schema && Object.keys(schema as Record<string, unknown>).length > 0;

/** The warnings that apply to this source; a workflow has no middlewares or request schemas. */
function useWarnings(source: SandboxSource) {
	const isRoute = source.kind === "route";
	const { data: route } = routesQuery.byId.useQuery(isRoute ? source.id : "");
	const { data: middlewares } = middlewaresQuery.forRoute.useQuery(isRoute ? source.id : "");
	if (!isRoute) return [];
	return copyWarnings({
		hasMiddlewares: !!middlewares && middlewares.before.length + middlewares.after.length > 0,
		hasSchemas: [route?.bodySchema, route?.querySchema, route?.paramsSchema].some(hasSchema),
	});
}

/**
 * The confirm step of a copy to a sandbox (#752). It always asks first, so a
 * stray click never makes a sandbox; the dialog also says what will not come
 * along. `canvas` copies from a saved version (#738) rather than the live canvas.
 */
export function OpenInSandboxDialog({
	projectId,
	source,
	canvas,
	warnings,
	open,
	onOpenChange,
	onOpen,
}: {
	projectId: string;
	source: SandboxSource;
	/** copy these blocks instead of the live canvas */
	canvas?: CanvasItems;
	warnings: string[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** the new sandbox is saved: open it */
	onOpen: (sandboxId: string) => void;
}) {
	const [pending, setPending] = useState(false);

	async function copy() {
		setPending(true);
		try {
			const sandboxId = await openInSandbox(projectId, source, canvas);
			toast.success("Copied to a new sandbox");
			onOpenChange(false);
			onOpen(sandboxId);
		} catch (error) {
			showErrorNotification(error);
		} finally {
			setPending(false);
		}
	}

	return (
		<ConfirmDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Open in sandbox"
			confirmText="Create sandbox"
			pending={pending}
			onConfirm={() => void copy()}
		>
			<p>
				This creates a new sandbox, {source.name} sandbox, with a copy of this canvas and opens it.{" "}
				{source.name} is not changed.
			</p>
			{warnings.length > 0 && (
				<>
					<p className="mt-2">Some things do not come along:</p>
					<ul className="mt-1 list-disc space-y-1 pl-5">
						{warnings.map((warning) => (
							<li key={warning}>{warning}</li>
						))}
					</ul>
				</>
			)}
		</ConfirmDialog>
	);
}

/** Copies the whole canvas into a new sandbox of yours and opens it (#752). */
export function OpenInSandboxButton({
	projectId,
	source,
	onOpen,
}: {
	projectId: string;
	source: SandboxSource;
	/** the new sandbox is saved: open it */
	onOpen: (sandboxId: string) => void;
}) {
	const canEdit = useCanEditProject(projectId);
	const warnings = useWarnings(source);
	const [confirming, setConfirming] = useState(false);

	// sandboxes are for creators and above
	if (!canEdit) return null;
	return (
		<>
			<Button variant="outline" onPress={() => setConfirming(true)}>
				<TbFlask size={16} /> Open in sandbox
			</Button>
			<OpenInSandboxDialog
				projectId={projectId}
				source={source}
				warnings={warnings}
				open={confirming}
				onOpenChange={setConfirming}
				onOpen={onOpen}
			/>
		</>
	);
}
