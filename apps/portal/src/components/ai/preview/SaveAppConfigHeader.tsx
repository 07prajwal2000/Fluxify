import { Chip } from "@fluxify/components";
import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";

/**
 * save_app_config's folded row (#780): a New / Update chip, the key, and its
 * value — or `encrypted` for one whose value is not readable.
 */
export function SaveAppConfigHeader({ tool }: { tool: ToolPart }) {
	const input = rec(tool.input);
	const isNew = input.appConfigId === undefined || input.appConfigId === null;
	const key = str(input.keyName);
	const encrypted = input.isEncrypted === true;
	const value = encrypted ? "encrypted" : str(input.value) || str(input.devValue);
	return (
		<span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle">
			<Chip size="sm" color={isNew ? "accent" : "default"}>
				{isNew ? "New" : "Update"}
			</Chip>
			{key && <span className="truncate text-foreground">{key}</span>}
			{value && <span className="min-w-0 truncate">= {value}</span>}
		</span>
	);
}
