import type { ToolPart } from "../agentMessages";
import { isRec, rec, str } from "./data";

const names = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** list_advanced_tools gives "name: what it does" lines. */
export const isToolLines = (output: unknown) =>
	Array.isArray(output) && output.length > 0 && output.every((l) => typeof l === "string");

export function AdvancedToolsPreview({ tool }: { tool: ToolPart }) {
	return (
		<ul className="flex list-disc flex-col gap-1 pl-4 text-xs marker:text-muted">
			{(tool.output as string[]).map((line) => {
				const at = line.indexOf(": ");
				const name = at < 0 ? line : line.slice(0, at);
				return (
					<li key={name}>
						<span className="font-mono text-foreground">{name}</span>
						{at >= 0 && <span className="text-muted"> — {line.slice(at + 2)}</span>}
					</li>
				);
			})}
		</ul>
	);
}

export const isLoadResult = (output: unknown) =>
	isRec(output) && (names(output.loaded).length > 0 || names(output.unknown).length > 0);

/** load_tools: the tools that are ready now, and any name that is not a tool. */
export function LoadedToolsPreview({ tool }: { tool: ToolPart }) {
	const out = rec(tool.output);
	const groups = [
		["Loaded", names(out.loaded), "text-foreground"],
		["Not found", names(out.unknown), "text-danger"],
	] as const;
	return (
		<div className="flex flex-col gap-2 text-xs">
			{groups.map(
				([label, list, tone]) =>
					list.length > 0 && (
						<section key={label} className="flex flex-col gap-1">
							<h4 className="font-medium text-muted">{label}</h4>
							<ul className="flex list-disc flex-col gap-0.5 pl-4 marker:text-muted">
								{list.map((n) => (
									<li key={n} className={`font-mono ${tone}`}>
										{n}
									</li>
								))}
							</ul>
						</section>
					),
			)}
		</div>
	);
}
