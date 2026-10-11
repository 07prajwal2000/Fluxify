import { Button, toast } from "@fluxify/components";
import { useState } from "react";
import { TbFlask } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import { routesQuery } from "@/query/routesQuery";
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
 * Copies the whole canvas into a new sandbox of yours and opens it (#752). With
 * something that will not come along, a dialog says what first.
 */
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
	const [pending, setPending] = useState(false);

	async function copy() {
		setPending(true);
		try {
			const sandboxId = await openInSandbox(projectId, source);
			toast.success("Copied to a new sandbox");
			setConfirming(false);
			onOpen(sandboxId);
		} catch (error) {
			showErrorNotification(error);
		} finally {
			setPending(false);
		}
	}

	// sandboxes are for creators and above
	if (!canEdit) return null;
	return (
		<>
			<Button
				variant="outline"
				isPending={pending && !confirming}
				onPress={() => (warnings.length ? setConfirming(true) : void copy())}
			>
				<TbFlask size={16} /> Open in sandbox
			</Button>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Open in sandbox"
				confirmText="Copy anyway"
				pending={pending}
				onConfirm={() => void copy()}
			>
				<p>
					This copies the canvas into a new sandbox, {source.name} sandbox. Some things do not come
					along:
				</p>
				<ul className="mt-2 list-disc space-y-1 pl-5">
					{warnings.map((warning) => (
						<li key={warning}>{warning}</li>
					))}
				</ul>
			</ConfirmDialog>
		</>
	);
}
