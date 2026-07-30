import React from "react";
import { Button } from "@fluxify/components";
import {
	TbStack2,
	TbCloudCog,
	TbSquareKey,
	TbBox,
	TbDatabase
} from "react-icons/tb";
import { useAiHarnessStore } from "@/store/aiHarness";
import { FiBox, FiMap } from "react-icons/fi";

// --- Inline Chips ---

interface CreationChipProps {
	label: string;
	kind: string;
}

export function CreationInlineBtn(props: CreationChipProps) {
	const { label, kind } = props;
	const setSelectedArtifact = useAiHarnessStore((s) => s.setSelectedArtifact);
	return (
		<Button
			size="sm"
			className="h-6 min-h-0 min-w-0 px-2 mx-1 inline-flex items-center align-baseline text-[var(--accent)] bg-[var(--accent)]/10 hover:bg-[var(--accent)]/20 border border-dashed border-[var(--accent)]/40 cursor-pointer"
			onPress={() => setSelectedArtifact({ id: label, type: kind, props })}
		>
			Create {kind}: {label}
		</Button>
	);
}

// --- Block Buttons ---

interface RouteButtonProps {
	type: "add" | "delete" | "changes";
	sub_artifact_id: string;
}

export function RouteButton(props: RouteButtonProps) {
	const { type, sub_artifact_id } = props;
	const setSelectedArtifact = useAiHarnessStore((s) => s.setSelectedArtifact);
	const colors = {
		add: "success",
		delete: "danger",
		changes: "warning",
	} as const;

	return (
		<div className="mt-2 mb-4">
			<Button
				size="sm"
				className="bg-[var(--surface-secondary)] border border-[var(--border)] hover:bg-[var(--border-secondary)] text-foreground flex items-center gap-2 cursor-pointer"
				onPress={() => setSelectedArtifact({ id: sub_artifact_id, type: `Route ${type}`, props })}
			>
				<FiMap className="h-4 w-4 text-foreground/70" />
				<span>View Route {type === "changes" ? "Changes" : type === "add" ? "Creation" : "Deletion"}</span>
			</Button>
		</div>
	);
}

interface CanvasChangesButtonProps {
	parent_type: "artifact" | "route" | "custom_block";
	parent: string;
	artifact_id: string;
}

export function CanvasChangesButton(props: CanvasChangesButtonProps) {
	const { parent_type, parent, artifact_id } = props;
	const setSelectedArtifact = useAiHarnessStore((s) => s.setSelectedArtifact);
	return (
		<div className="mt-2 mb-4">
			<Button
				size="sm"
				className="bg-[var(--surface-secondary)] border border-[var(--border)] hover:bg-[var(--border-secondary)] text-foreground flex items-center gap-2 cursor-pointer"
				onPress={() => setSelectedArtifact({ id: artifact_id, type: `Canvas Changes (${parent_type})`, props })}
			>
				<FiBox className="h-4 w-4 text-foreground/70" />
				<span>View Canvas Changes ({parent_type.replace("_", " ")})</span>
			</Button>
		</div>
	);
}
