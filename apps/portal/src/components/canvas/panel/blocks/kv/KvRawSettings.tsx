import { Description, JavaScriptTextArea, Label } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { TbCode } from "react-icons/tb";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import type { BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import { BlockIntegrationField } from "../../fields";

/** General tab: which KV store to talk to. */
export function KvRawGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockIntegrationField
				blockId={block.id}
				data={block.data}
				name="connection"
				group="kv"
				label="Choose KV Connection"
				description="Select the Redis or Memcached connection to run raw commands against."
			/>
		</div>
	);
}

const KV_TYPE_DEFINITIONS = `
declare const kv: {
	/** Get the value of a key. */
	get(key: string): Promise<string | null>;
	/** Set the string value of a key. */
	set(key: string, value: string | number, ...args: any[]): Promise<any>;
	/** Delete one or more keys. */
	del(...keys: string[]): Promise<number>;
	/** Increment the integer value of a key by one. */
	incr(key: string): Promise<number>;
	/** Decrement the integer value of a key by one. */
	decr(key: string): Promise<number>;
	/** Set the value and expiration of a key. */
	setex(key: string, seconds: number, value: string): Promise<string>;
	/** Get the value of a hash field. */
	hget(key: string, field: string): Promise<string | null>;
	/** Set the string value of a hash field. */
	hset(key: string, field: string, value: string): Promise<number>;
	/** Get all the fields and values in a hash. */
	hgetall(key: string): Promise<Record<string, string>>;
	/** Additional methods available depending on the exact driver. */
	[method: string]: any;
};
`;

/** Code tab: JavaScript with the raw client exposed as `kv`. */
export function KvRawCodeSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();

	const jsCode = typeof block.data.js === "string" ? block.data.js : "";

	return (
		<div className="flex flex-col gap-4 w-full">
			<div className="flex items-start gap-2.5 p-3 rounded-lg bg-background-secondary border border-border text-xs text-muted leading-relaxed">
				<TbCode className="size-4 shrink-0 text-accent mt-0.5" />
				<div>
					You have access to{" "}
					<code className="font-mono text-foreground font-semibold px-1 py-0.5 rounded bg-surface-secondary">
						kv
					</code>
					, the raw client for the selected connection — ioredis for Redis, the memcached client for
					Memcached. Use its own commands, e.g.{" "}
					<code className="font-mono text-foreground font-semibold px-1 py-0.5 rounded bg-surface-secondary">
						await kv.incr('hits')
					</code>
					. Whatever you return becomes this block's output.
				</div>
			</div>

			<div className="flex flex-col gap-1.5 w-full">
				<div className="flex items-center justify-between">
					<div className="flex flex-col gap-0.5">
						<Label className="text-sm font-medium">JavaScript Code</Label>
						<Description className="text-xs text-muted">
							Write JavaScript code to run commands and return output.
						</Description>
					</div>
				</div>
				<JavaScriptTextArea
					expandable
					expandTitle="KV Raw - Code Editor"
					rows={14}
					showLineNumbers={true}
					readOnly={!editable}
					value={jsCode}
					typeDefinitions={KV_TYPE_DEFINITIONS}
					onChange={(next) => updateNodeData(block.id, { js: next })}
				/>
			</div>
		</div>
	);
}

export function kvRawSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<KvRawGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="code" name="Code">
			<KvRawCodeSettings block={block} />
		</BlockSettings.TabHead>,
	];
}
