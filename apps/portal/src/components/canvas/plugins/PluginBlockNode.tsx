import { type NodeProps, useNodeConnections, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";
import { TbPlugOff } from "react-icons/tb";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { pluginBlockIcon } from "@/components/settings/plugins/pluginBlockIcon";
import { BaseBlock } from "../blocks/BaseBlock";
import { blockDefinition } from "../blocks/blockCatalog";
import { blockLabels } from "../blocks/blockLabels";
import { BlockHandle } from "../blocks/handles/BlockHandle";
import { DeprecatedBadge } from "./DeprecatedBadge";
import { usePluginBlocks } from "./PluginBlocksContext";
import { pluginHandleProps } from "./pluginHandles";

const status = (value: unknown) => (typeof value === "boolean" ? value : null);

/**
 * A plugin's block, drawn from its manifest: a square or a wide card, its icon,
 * and the sockets its spec declares. The canvas saves nothing of this; a block
 * is only its type, so the manifest can change under a saved canvas.
 */
export function PluginBlockNode(props: NodeProps) {
	const { id, type, data, selected, positionAbsoluteX, positionAbsoluteY } = props;
	const { byType, isLoading } = usePluginBlocks();
	const def = byType[type];
	const updateNodeInternals = useUpdateNodeInternals();
	const sockets = def ? pluginHandleProps(def.handles) : [];

	// Sockets that arrive after the node first rendered (the manifests load late,
	// or an upgrade changed them) are measured again, or their edges would not attach.
	const signature = JSON.stringify(sockets);
	// biome-ignore lint/correctness/useExhaustiveDependencies: the signature is the trigger
	useEffect(() => updateNodeInternals(id), [id, signature, updateNodeInternals]);

	if (!def) return <MissingPluginBlock {...props} pending={isLoading} />;
	const { name, description, custom } = blockLabels(type, data);
	return (
		<BaseBlock
			variant={def.shape === "square" ? "compact" : "default"}
			blockId={id}
			blockType={type}
			position={{ x: positionAbsoluteX, y: positionAbsoluteY }}
			name={custom ? name : def.label}
			description={
				description === blockDefinition(type).description ? def.description : description
			}
			icon={<CustomBlockIcon {...pluginBlockIcon(def.entry)} />}
			selected={selected}
			status={status(data?.status)}
		>
			{sockets.map((socket) => (
				<BlockHandle key={socket.name} blockId={id} {...socket} />
			))}
			{def.deprecated && (
				<DeprecatedBadge message={def.deprecated} className="absolute -top-2.5 right-2 z-10" />
			)}
		</BaseBlock>
	);
}

/** `acme/slack/messages/post` → `acme/slack` */
const pluginOf = (type: string) => type.split("/").slice(0, 2).join("/");

/**
 * A block whose plugin the project does not have (removed, rejected, or never
 * added). It keeps its place and its edges: sockets are rebuilt from the edges
 * that end on it, so deleting the node is the user's call, not a side effect.
 */
function MissingPluginBlock({
	id,
	type,
	data,
	selected,
	positionAbsoluteX,
	positionAbsoluteY,
	pending,
}: NodeProps & { pending: boolean }) {
	const connections = useNodeConnections();
	// this node's own handle names, from the ids on the edges that end on it
	const handleNames = (end: "source" | "target") => [
		...new Set(
			connections.flatMap((c) => {
				const handle = c[`${end}Handle`];
				return c[end] === id && handle?.startsWith(`${id}-`) ? [handle.slice(id.length + 1)] : [];
			}),
		),
	];
	const { name, custom } = blockLabels(type, data);

	return (
		<BaseBlock
			blockId={id}
			blockType={type}
			position={{ x: positionAbsoluteX, y: positionAbsoluteY }}
			name={custom ? name : (type.split("/").at(-1) ?? type)}
			description={pending ? "Loading plugins…" : `Plugin ${pluginOf(type)} is not installed`}
			icon={<TbPlugOff size={18} />}
			selected={selected}
			className="fx-block--missing"
		>
			{handleNames("target").map((handle) => (
				<BlockHandle
					key={`in-${handle}`}
					blockId={id}
					kind="target"
					name={handle}
					maxConnections={0}
				/>
			))}
			{handleNames("source").map((handle) => (
				<BlockHandle
					key={`out-${handle}`}
					blockId={id}
					kind="source"
					name={handle}
					label={handle}
					maxConnections={0}
				/>
			))}
		</BaseBlock>
	);
}
