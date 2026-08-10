import { useState } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { TbCheck, TbChevronDown, TbExternalLink } from "react-icons/tb";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useArtifactParams } from "./useArtifact";

/** Once an output has landed there is nothing left to apply, so the control
 *  becomes a way into the thing that changed. */
function Applied({
	appliedAt,
	routeId,
	target,
}: {
	appliedAt: string | Date;
	routeId?: string;
	target: "editor" | "canvas";
}) {
	const { projectId } = useArtifactParams();
	return (
		<div className="flex items-center gap-3">
			{routeId && (
				<Button size="sm" className="cursor-pointer">
					<Link
						to={
							target === "canvas"
								? "/$projectId/canvas/$routeId"
								: "/$projectId/editor/$routeId"
						}
						params={{ projectId, routeId }}
						className="flex items-center gap-2"
					>
						Go to route <TbExternalLink size={14} />
					</Link>
				</Button>
			)}
			<span className="flex items-center gap-1 text-xs text-muted">
				<TbCheck size={14} className="text-success" />
				Applied {new Date(appliedAt).toLocaleString()}
			</span>
		</div>
	);
}

/** Applies sub-artifacts in the order given — a canvas is only valid once the
 *  route it hangs off exists, so order is the caller's contract. */
function useApply() {
	const { projectId, conversationId } = useArtifactParams();
	const apply = harnessConversationsQuery.applySubArtifact.mutation(
		projectId,
		conversationId,
	);
	const run = async (ids: string[]) => {
		try {
			for (const id of ids) await apply.mutateAsync(id);
		} catch (error) {
			showErrorNotification(error as Error);
		}
	};
	return { run, isPending: apply.isPending };
}

export function ApplyBar({
	subArtifactId,
	appliedAt,
	routeId,
	target = "editor",
	label = "Apply",
}: {
	subArtifactId: string;
	appliedAt: string | Date | null;
	/** live route to link to once applied; omit to only show the applied stamp */
	routeId?: string;
	target?: "editor" | "canvas";
	label?: string;
}) {
	const { run, isPending } = useApply();

	if (appliedAt)
		return <Applied appliedAt={appliedAt} routeId={routeId} target={target} />;

	return (
		<Button
			size="sm"
			variant="primary"
			isPending={isPending}
			isDisabled={isPending}
			className="cursor-pointer self-start"
			onPress={() => void run([subArtifactId])}
		>
			{label}
		</Button>
	);
}

const VERB: Record<string, string> = {
	create: "Create",
	"update-partial": "Update",
	delete: "Delete",
};

/**
 * Route apply, with its canvas along for the ride. A run usually changes the
 * settings and the logic together, so applying both is the default — but a user
 * who only wanted the settings touched can still take the route alone.
 */
export function RouteApplyBar({
	subArtifactId,
	canvasSubArtifactId,
	appliedAt,
	routeId,
	action,
}: {
	subArtifactId: string;
	/** the same run's canvas output for this route, if it produced one */
	canvasSubArtifactId?: string;
	appliedAt: string | Date | null;
	routeId?: string;
	action: string;
}) {
	const { run, isPending } = useApply();
	const [open, setOpen] = useState(false);
	const verb = VERB[action] ?? "Apply";

	if (appliedAt)
		return <Applied appliedAt={appliedAt} routeId={routeId} target="editor" />;

	if (!canvasSubArtifactId)
		return (
			<Button
				size="sm"
				variant="primary"
				isPending={isPending}
				isDisabled={isPending}
				className="cursor-pointer self-start"
				onPress={() => void run([subArtifactId])}
			>
				{verb} route
			</Button>
		);

	// A brand-new route has nothing useful without the canvas that defines it
	// (it would be entrypoint/response/error-handler defaults, not the plan the
	// agent produced), so for a create there is no "route only" alternative
	// worth offering. Applying still lands as two calls (route, then canvas),
	// but the server now reconciles a stale default entrypoint/error-handler
	// against the incoming canvas instead of rejecting it as a duplicate — see
	// `saveCanvas`'s `mergeAiDuplicates` path — so the sequence is safe.
	if (action === "create")
		return (
			<Button
				size="sm"
				variant="primary"
				isPending={isPending}
				isDisabled={isPending}
				className="cursor-pointer self-start"
				onPress={() => void run([subArtifactId, canvasSubArtifactId])}
			>
				{verb} route with canvas
			</Button>
		);

	return (
		<div className="flex items-stretch self-start">
			<Button
				size="sm"
				variant="primary"
				isPending={isPending}
				isDisabled={isPending}
				className="cursor-pointer rounded-r-none"
				// the route first: its canvas has nothing to hang off until it exists
				onPress={() => void run([subArtifactId, canvasSubArtifactId])}
			>
				{verb} route with canvas
			</Button>
			<Popover isOpen={open} onOpenChange={setOpen}>
				<PopoverTrigger>
					<Button
						size="sm"
						variant="primary"
						isDisabled={isPending}
						aria-label="Other apply options"
						className="cursor-pointer rounded-l-none border-l border-black/20 px-2"
					>
						<TbChevronDown size={16} />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="p-1">
					<button
						type="button"
						className="w-full text-left text-sm px-3 py-2 rounded-md hover:bg-white/10 cursor-pointer"
						onClick={() => {
							setOpen(false);
							void run([subArtifactId]);
						}}
					>
						{verb} route only
					</button>
				</PopoverContent>
			</Popover>
		</div>
	);
}
