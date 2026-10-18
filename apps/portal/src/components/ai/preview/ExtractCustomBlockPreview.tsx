import type { ToolPart } from "../agentMessages";
import type { RefType } from "../agentRefs";
import { rec, str } from "./data";
import { Notice } from "./Notice";
import { ResourceHeader } from "./ResourceHeader";
import { isDone } from "./tool";

const kindLabel = (kind: string) => kind.replace("_", " ");

const keysOf = (input: Record<string, unknown>) =>
	Array.isArray(input.keys) ? input.keys.map(str).filter(Boolean) : [];

/**
 * The accordion summary for extract_custom_block, e.g.
 * "Extracted 2 blocks from Draft (sandbox) → Shout text (user_defined.p.shout_text)".
 * The parenthesis is the block's internal name once the server has stored it.
 */
export function extractHeader(tool: ToolPart, asking = false): string {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const from = rec(input.from);
	const fromKind = str(from.kind) || "canvas";
	const fromName = str(input.fromName) || str(from.name);
	const count = keysOf(input).length;
	const blocks = count ? `${count} block${count === 1 ? "" : "s"}` : "blocks";
	const verb = isDone(tool) && !asking ? "Extracted" : "Extract";
	const source = fromName ? `${fromName} (${kindLabel(fromKind)})` : kindLabel(fromKind);
	const label = str(input.label) || str(input.name);
	const internal = str(out.name);
	const target = internal ? `${label} (${internal})` : label;
	return `${verb} ${blocks} from ${source}${target ? ` → ${target}` : ""}`;
}

/** What extract_custom_block did or will do: the source canvas, the selected keys, and the block it made. */
export function ExtractCustomBlockPreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const done = isDone(tool) && !asking;
	const input = rec(tool.input);
	const out = rec(tool.output);
	const from = rec(input.from);
	const keys = keysOf(input);
	const created = str(out.id);
	const instance = str(out.instanceKey);
	const replace = input.replace === true || input.replace === "true";
	const fromKind = (str(from.kind) || "route") as RefType;
	const fromName = str(input.fromName) || str(from.name);

	return (
		<div className="flex flex-col gap-2">
			{asking && replace && (
				<Notice tone="warning">
					The selected blocks will be replaced on this canvas by one{" "}
					<strong>{str(input.label) || str(input.name)}</strong> block.
				</Notice>
			)}

			<section aria-label="Source" className="flex flex-col gap-1">
				<h4 className="text-xs font-medium text-muted">From</h4>
				{from.id ? (
					<ResourceHeader type={fromKind} id={str(from.id)} name={fromName} />
				) : (
					<span className="text-sm text-muted">{kindLabel(fromKind)}</span>
				)}
			</section>

			{keys.length > 0 && (
				<section aria-label="Selected blocks" className="flex flex-col gap-1">
					<h4 className="text-xs font-medium text-muted">
						{keys.length} selected block{keys.length === 1 ? "" : "s"}
					</h4>
					<ul className="flex flex-wrap gap-1.5 font-mono text-xs">
						{keys.map((key) => (
							<li
								key={key}
								className="rounded border border-border bg-surface px-1.5 py-0.5 text-foreground"
							>
								{key}
							</li>
						))}
					</ul>
				</section>
			)}

			<section aria-label="Custom block" className="flex flex-col gap-1">
				<h4 className="text-xs font-medium text-muted">Custom block</h4>
				<ResourceHeader
					type="custom_block"
					id={created || undefined}
					name={str(input.label) || str(input.name)}
					detail={str(out.name) || str(input.name)}
					badge={done ? "new" : undefined}
				/>
				{done && instance && (
					<p className="text-xs text-muted">
						Replaced the selection with{" "}
						<code className="rounded bg-surface-secondary px-1.5 font-mono">{instance}</code>
					</p>
				)}
			</section>
		</div>
	);
}
