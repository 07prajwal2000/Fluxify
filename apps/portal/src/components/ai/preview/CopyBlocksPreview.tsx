import type { ToolPart } from "../agentMessages";
import type { RefType } from "../agentRefs";
import { CanvasDiffView } from "./CanvasDiffView";
import type { CanvasDiff, DiffBlock } from "./canvasDiff";
import { isRec, rec, str } from "./data";
import { Notice } from "./Notice";
import { ResourceHeader } from "./ResourceHeader";
import { isDone } from "./tool";

function typeOfKey(key: string) {
	return key.replace(/_\d+$/, "");
}

/** Previews what copy_blocks did or will copy: target link, key mapping, warnings, and canvas diff. */
export function CopyBlocksPreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const done = isDone(tool) && !asking;
	const input = rec(tool.input);
	const out = rec(tool.output);

	const targetOut = rec(out.target);
	const toRef = input.to === "__new_sandbox__" ? null : rec(input.to);
	const targetKind = (str(targetOut.kind) || str(toRef?.kind) || "sandbox") as RefType;
	const targetId = str(targetOut.id) || str(toRef?.id);
	const fromRef = rec(input.from);
	const fromName = str(input.fromName) || str(fromRef.name) || (fromRef.id ? str(fromRef.id) : "");
	const targetName =
		str(targetOut.name) ||
		(input.to === "__new_sandbox__"
			? fromName
				? `${fromName} sandbox`
				: "New sandbox"
			: str(toRef?.name) || str(toRef?.id) || "Target");

	// Key mapping from output
	const keyMap = isRec(out.keys) ? (out.keys as Record<string, string>) : undefined;

	// Warnings & issues
	const warnings = Array.isArray(out.warnings) ? (out.warnings as string[]) : [];
	const issues = Array.isArray(out.issues)
		? (out.issues as { message?: string; severity?: string }[])
		: [];

	// Build diff for CanvasDiffView
	const keysToRender = keyMap
		? Object.entries(keyMap).map(([srcKey, dstKey]) => ({
				key: dstKey,
				srcKey,
			}))
		: Array.isArray(input.keys)
			? input.keys.map((k) => ({ key: str(k), srcKey: str(k) }))
			: [];

	const blocks: DiffBlock[] = keysToRender.map(({ key, srcKey }) => ({
		key,
		type: typeOfKey(key),
		status: "added",
		data: {},
		changes: [{ field: "source", before: srcKey, after: key }],
	}));

	const diff: CanvasDiff = { blocks, edges: [], partial: true };

	return (
		<div className="flex flex-col gap-2">
			{targetId && (
				<ResourceHeader
					type={targetKind}
					id={targetId}
					name={targetName}
					badge={done ? "saved" : "new"}
				/>
			)}

			{asking && (
				<Notice tone="warning">
					This action will copy {blocks.length ? `${blocks.length} block(s)` : "blocks"} to{" "}
					<strong>{targetName}</strong>.
				</Notice>
			)}

			{warnings.map((w) => (
				<Notice key={w} tone="warning">
					{w}
				</Notice>
			))}

			{issues.map((i) => (
				<Notice key={i.message ?? "issue"} tone={i.severity === "error" ? "danger" : "warning"}>
					{i.message}
				</Notice>
			))}

			{keyMap && Object.keys(keyMap).length > 0 && (
				<section aria-label="Key mapping" className="flex flex-col gap-1">
					<h4 className="text-xs font-medium text-muted">Key mapping</h4>
					<div className="flex flex-wrap gap-1.5 font-mono text-xs">
						{Object.entries(keyMap).map(([src, dst]) => (
							<span
								key={src}
								className="rounded border border-border bg-surface px-1.5 py-0.5 text-foreground"
							>
								{src} → {dst}
							</span>
						))}
					</div>
				</section>
			)}

			{blocks.length > 0 && <CanvasDiffView diff={diff} />}
		</div>
	);
}
