import { Checkbox, Tabs } from "@fluxify/components";
import {
	TbChevronDown,
	TbKey,
	TbList,
	TbPlug,
	TbPlus,
} from "react-icons/tb";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { ApplyBar } from "./ApplyBar";
import { CanvasPreview } from "./CanvasPreview";
import { Field } from "./Field";
import {
	useArtifactParams,
	useCustomBlockCanvasArtifact,
	useRunSiblings,
} from "./useArtifact";

/** What the custom block sub-agent writes (see ai-gateway `CustomBlockConfigPayload`). */
type InputParam = {
	name?: string;
	type?: string;
	label?: string;
	description?: string;
	group?: string;
	variant?: string;
	options?: Array<{ label?: string; value?: string }>;
};

type CustomBlockConfigPayload = {
	action?: "create" | "delete" | "update-partial";
	customBlockId?: string | null;
	data?: {
		name?: string | null;
		label?: string | null;
		description?: string | null;
		inputParams?: InputParam[] | null;
	} | null;
};

/** A dead control that looks like the real one. The caller configures this block
 *  through the settings panel in `blocks/CustomBlockSettings.tsx`; those fields
 *  are wired to canvas change-tracking and cannot render outside a canvas, so
 *  each type gets a matching read-only stand-in here. */
function ControlPreview({ param }: { param: InputParam }) {
	const box =
		"flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-muted";

	switch (param.type) {
		case "checkbox":
			return (
				<Checkbox isSelected={false} isDisabled label={param.label ?? param.name} />
			);

		case "dropdown": {
			const options = param.options ?? [];
			return (
				<div className="flex flex-col gap-1.5">
					<div className={`${box} justify-between`}>
						<span>{options[0]?.label ?? options[0]?.value ?? "Select…"}</span>
						<TbChevronDown size={14} className="shrink-0" />
					</div>
					{options.length > 1 && (
						<div className="flex flex-wrap gap-1">
							{options.map((option, index) => (
								<span
									key={`${option.value ?? option.label}-${index}`}
									className="rounded-md border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted"
								>
									{option.value ?? option.label}
								</span>
							))}
						</div>
					)}
				</div>
			);
		}

		case "array_editor":
			return (
				<div className="flex flex-col gap-1.5">
					<div className={box}>
						<TbList size={14} className="shrink-0" />
						<span>item 1</span>
					</div>
					<div className="flex items-center gap-1.5 text-[11px] text-muted/70">
						<TbPlus size={12} />
						<span>caller adds any number of entries</span>
					</div>
				</div>
			);

		case "integration_selector":
			return (
				<div className={`${box} justify-between`}>
					<span className="flex items-center gap-2">
						<TbPlug size={14} className="shrink-0" />
						Pick a connection
					</span>
					{param.group && (
						<span className="rounded-md border border-border bg-surface-secondary px-1.5 py-0.5 font-mono text-[11px]">
							{param.group}
							{param.variant ? ` · ${param.variant}` : ""}
						</span>
					)}
				</div>
			);

		case "app_config_selector":
			return (
				<div className={box}>
					<TbKey size={14} className="shrink-0" />
					<span>
						Pick a config key — read at runtime with{" "}
						<code className="font-mono text-foreground/70">
							getConfig(params.{param.name ?? "key"})
						</code>
					</span>
				</div>
			);

		case "text_input":
			return (
				<div className={box}>
					<span className="text-muted/70">value or</span>
					<code className="font-mono text-foreground/70">js: expression</code>
				</div>
			);

		default:
			return (
				<div className={box}>
					<span>Unknown parameter type “{param.type ?? "—"}”</span>
				</div>
			);
	}
}

/** The caller-facing name for each type — "Text" reads better above a field than
 *  `text_input` does. */
const TYPE_LABEL: Record<string, string> = {
	text_input: "Text",
	checkbox: "Toggle",
	dropdown: "Dropdown",
	array_editor: "List",
	integration_selector: "Integration",
	app_config_selector: "App config",
};

function ParamRow({
	param,
	state,
}: {
	param: InputParam;
	state: "added" | "removed" | "kept";
}) {
	const tone =
		state === "added"
			? "border-success/30 bg-success/5"
			: state === "removed"
				? "border-danger/30 bg-danger/5"
				: "border-border bg-surface-secondary";

	return (
		<div className={`flex flex-col gap-2 rounded-lg border p-3 ${tone}`}>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 flex-col gap-0.5">
					<span
						className={`text-sm font-medium ${
							state === "removed" ? "text-muted line-through" : "text-foreground"
						}`}
					>
						{param.label || param.name || "Unnamed"}
					</span>
					{/* the key the implementation reads as `params.<name>` */}
					<span className="font-mono text-[11px] text-muted break-all">
						params.{param.name ?? "unnamed"}
					</span>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					<span className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted">
						{TYPE_LABEL[param.type ?? ""] ?? param.type ?? "unknown"}
					</span>
					{state !== "kept" && (
						<span
							className={`text-[10px] font-bold uppercase tracking-wider ${
								state === "added" ? "text-success" : "text-danger"
							}`}
						>
							{state}
						</span>
					)}
				</div>
			</div>

			{param.description && (
				<p className="text-xs text-muted break-words">{param.description}</p>
			)}

			{state !== "removed" && <ControlPreview param={param} />}
		</div>
	);
}

export function CustomBlockArtifact({ subArtifactId }: { subArtifactId: string }) {
	const { projectId, conversationId } = useArtifactParams();
	const { data: detail, isLoading } =
		harnessConversationsQuery.subArtifacts.useDetailQuery(
			projectId,
			conversationId,
			subArtifactId,
		);

	const payload = (detail?.payload ?? {}) as CustomBlockConfigPayload;
	const action = payload.action ?? "create";
	const customBlockId = payload.customBlockId ?? "";
	const proposed = payload.data ?? {};

	// A create has nothing to merge against; for an update this is what the
	// caller contract looks like today, which is the whole point of the diff.
	const { data: blocks } = customBlocksQuery.getAll.useQuery(projectId);
	const existing = blocks?.find((b) => b.id === customBlockId);
	const existingParams: InputParam[] = Array.isArray(existing?.inputParams)
		? (existing.inputParams as InputParam[])
		: [];

	// The same run may have built this block's logic. Showing it here is the only
	// way to tell whether the graph changed before applying the contract.
	const canvasSibling = useRunSiblings(detail?.runId, "canvas").find(
		(s) =>
			s.payload?.targetType === "custom_block" &&
			s.payload?.targetId === customBlockId,
	);
	const { graph: canvasGraph } = useCustomBlockCanvasArtifact(canvasSibling);

	if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
	if (!detail) return <p className="text-sm text-muted">Not found.</p>;

	const isDelete = action === "delete";
	const title = proposed.label || existing?.label || proposed.name || existing?.name;
	const name = proposed.name || existing?.name || "";

	// `inputParams` is the caller's public API, so an added or dropped param is
	// the change that actually breaks callers — worth more than a JSON blob.
	const nextParams = proposed.inputParams ?? null;
	const nextNames = new Set((nextParams ?? []).map((p) => p.name));
	const removed = nextParams
		? existingParams.filter((p) => !nextNames.has(p.name))
		: [];
	const existingNames = new Set(existingParams.map((p) => p.name));
	const shownParams = nextParams ?? existingParams;

	return (
		<div className="flex flex-col gap-5">
			<div className="rounded-xl border border-border bg-surface-secondary p-3 flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<span className="text-xs px-2 py-0.5 rounded-md border border-border bg-surface uppercase tracking-wider text-foreground">
						{action}
					</span>
					{detail.appliedAt && (
						<span className="text-xs px-2 py-0.5 rounded-md border border-success/30 bg-success/10 text-success">
							applied
						</span>
					)}
				</div>
				<p className="text-sm font-medium text-foreground break-words">
					{title || "Custom block"}
				</p>
				{name && <p className="text-xs font-mono text-muted break-all">{name}</p>}
			</div>

			{isDelete ? (
				<Field label="Custom block" current={existing?.label ?? name ?? customBlockId} />
			) : (
				// Same split as the route panel: identity in one tab, the caller
				// contract in another — the parameter list is the long one.
				<Tabs defaultSelectedKey="general" className="flex flex-col gap-3">
					<Tabs.List aria-label="Custom block settings" className="w-full">
						<Tabs.Tab id="general">General</Tabs.Tab>
						<Tabs.Tab id="params">
							Parameters{shownParams.length ? ` (${shownParams.length})` : ""}
						</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel id="general" className="flex flex-col gap-4">
						<Field label="Label" current={existing?.label} next={proposed.label} />
						{/* the runtime block type — immutable once callers invoke it */}
						<Field label="Name" current={existing?.name} next={proposed.name} />
						<Field
							label="Description"
							current={existing?.description}
							next={proposed.description}
						/>
					</Tabs.Panel>

					<Tabs.Panel id="params" className="flex flex-col gap-2">
						<div className="flex flex-col gap-0.5">
							<span className="text-[10px] text-muted uppercase font-bold tracking-wider">
								Caller parameters
							</span>
							<span className="text-xs text-muted/70">
								How this block's settings panel will look to whoever invokes it.
							</span>
						</div>
						{shownParams.length === 0 && removed.length === 0 ? (
							<p className="text-sm text-muted">No caller parameters</p>
						) : (
							<>
								{shownParams.map((param, index) => (
									<ParamRow
										key={`${param.name ?? "param"}-${index}`}
										param={param}
										state={
											nextParams && !existingNames.has(param.name) && existing
												? "added"
												: "kept"
										}
									/>
								))}
								{removed.map((param, index) => (
									<ParamRow
										key={`removed-${param.name ?? "param"}-${index}`}
										param={param}
										state="removed"
									/>
								))}
							</>
						)}
					</Tabs.Panel>
				</Tabs>
			)}

			{canvasSibling && canvasGraph.blocks.length > 0 && (
				<div className="flex flex-col gap-2">
					<span className="text-[10px] text-muted uppercase font-bold tracking-wider">
						Canvas changes
					</span>
					<CanvasPreview graph={canvasGraph} title="Proposed custom-block canvas" />
				</div>
			)}

			<ApplyBar
				subArtifactId={detail.id}
				appliedAt={detail.appliedAt}
				// a deleted block has nothing left to open
				customBlockId={isDelete ? undefined : (payload.customBlockId ?? undefined)}
				label={`${
					isDelete ? "Delete" : action === "update-partial" ? "Update" : "Create"
				} custom block${canvasSibling ? " with canvas" : ""}`}
			/>
		</div>
	);
}
