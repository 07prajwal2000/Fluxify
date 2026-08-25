import { useState } from "react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { TbCheck, TbChevronDown, TbExternalLink } from "react-icons/tb";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useAiHarnessStore } from "@/store/aiHarness";
import { artifactTypeForKind, kindLabel, useArtifactParams } from "./useArtifact";

/** Once an output has landed there is nothing left to apply, so the control
 *  becomes a way into the thing that changed. */
function Applied({
	appliedAt,
	routeId,
	customBlockId,
}: {
	appliedAt: string | Date;
	routeId?: string;
	customBlockId?: string;
}) {
	const { projectId } = useArtifactParams();
	return (
		<div className="flex items-center gap-3">
			{routeId && (
				<Button size="sm" className="cursor-pointer">
					<Link
						to="/$projectId/canvas/$routeId"
						params={{ projectId, routeId }}
						className="flex items-center gap-2"
					>
						Go to route <TbExternalLink size={14} />
					</Link>
				</Button>
			)}
			{customBlockId && (
				<Button size="sm" className="cursor-pointer">
					<Link
						to="/$projectId/custom-block-canvas/$blockId"
						params={{ projectId, blockId: customBlockId }}
						className="flex items-center gap-2"
					>
						Go to custom block <TbExternalLink size={14} />
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

/** What this output is waiting on. Enough to name it and to open it. */
export type BlockingParent = { id: string; kind: string };

/**
 * An output whose parent is still a proposal. The server refuses this apply, so
 * offering the button would just produce a 409 — say what has to happen first
 * and give the user one click to get there.
 *
 * Deliberately not an "apply both" shortcut: creating a resource the user never
 * asked for, because they clicked a different one, is not theirs to undo.
 */
function Blocked({ parent }: { parent: BlockingParent }) {
	const setSelectedArtifact = useAiHarnessStore((s) => s.setSelectedArtifact);
	const what = kindLabel(parent.kind);
	return (
		<div className="flex items-center gap-3 self-start">
			<Button size="sm" variant="primary" isDisabled className="self-start">
				Needs the {what} applied first
			</Button>
			<button
				type="button"
				className="text-xs text-muted hover:text-foreground underline cursor-pointer"
				onClick={() =>
					setSelectedArtifact({
						id: parent.id,
						type: artifactTypeForKind(parent.kind),
						props: {},
					})
				}
			>
				Open the {what}
			</button>
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
	customBlockId,
	blockedBy,
	label = "Apply",
}: {
	subArtifactId: string;
	appliedAt: string | Date | null;
	/** live route to link to once applied; omit to only show the applied stamp */
	routeId?: string;
	/** live custom block to link to once applied */
	customBlockId?: string;
	/** sibling output that has to land first, if one has not yet */
	blockedBy?: BlockingParent;
	label?: string;
}) {
	const { run, isPending } = useApply();

	if (appliedAt) return <Applied appliedAt={appliedAt} routeId={routeId} customBlockId={customBlockId} />;
	if (blockedBy) return <Blocked parent={blockedBy} />;

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
	blockedBy,
}: {
	subArtifactId: string;
	/** the same run's canvas output for this route, if it produced one */
	canvasSubArtifactId?: string;
	appliedAt: string | Date | null;
	routeId?: string;
	action: string;
	/** sibling output that has to land first — a route invoking a custom block
	 *  this run created cannot execute until that block exists */
	blockedBy?: BlockingParent;
}) {
	const { run, isPending } = useApply();
	const [open, setOpen] = useState(false);
	const verb = VERB[action] ?? "Apply";

	if (appliedAt) return <Applied appliedAt={appliedAt} routeId={routeId} />;
	if (blockedBy) return <Blocked parent={blockedBy} />;

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

	// A route create carries its paired canvas in the same transaction. Sending
	// the canvas again would mint another set of ids for its new blocks.
	if (action === "create")
		return (
			<Button
				size="sm"
				variant="primary"
				isPending={isPending}
				isDisabled={isPending}
				className="cursor-pointer self-start"
				onPress={() => void run([subArtifactId])}
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
						className="cursor-pointer rounded-l-none border-l border-border px-2"
					>
						<TbChevronDown size={16} />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="p-1">
					<button
						type="button"
						className="w-full text-left text-sm px-3 py-2 rounded-md hover:bg-surface-secondary cursor-pointer"
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
