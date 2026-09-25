import { cn, JavaScriptTextArea, Label, Spinner, usePackageTypes } from "@fluxify/components";
import { useMemo, useState } from "react";
import { blockLabels } from "@/components/canvas/blocks/blockLabels";
import type { BlockData } from "@/components/canvas/types";
import { routesQuery } from "@/query/routesQuery";
import { ZOD_VERSION } from "./expectTypes";
import {
	HOOK_TEMPLATES,
	type HookSlot,
	hookErrors,
	hookSupport,
	hookTypes,
	slotsFor,
} from "./hooks";
import type { BlockHook, HookBody } from "./types";

const SLOT_LABELS: Record<HookSlot, string> = { onBefore: "Before", onAfter: "After" };

const tabClass = (active: boolean) =>
	cn(
		"rounded-md px-2 py-1 text-xs font-medium transition-colors",
		active
			? "bg-accent/10 text-accent"
			: "text-muted hover:bg-surface-secondary hover:text-foreground",
	);

/**
 * Text typed in each mode, kept for the session so flipping Off / Script / JSON
 * never loses work. Only what is selected at Save reaches the database.
 */
const unsaved = new Map<string, string>();

/**
 * Per-block `onBefore` / `onAfter` hooks for one suite (#483): change what a
 * block gets or returns, or skip it with a made-up output.
 */
export function HooksEditor({
	suiteId,
	routeId,
	hooks,
	onChange,
}: {
	suiteId: string;
	routeId: string;
	hooks: BlockHook[];
	onChange: (next: BlockHook[]) => void;
}) {
	usePackageTypes("zod", ZOD_VERSION);
	const canvas = routesQuery.canvasItems.useQuery(routeId);
	const blocks = useMemo(
		() =>
			(canvas.data?.blocks ?? [])
				.filter((b) => hookSupport(b.type) !== "none")
				.map((b) => ({ id: b.id, type: b.type, ...blockLabels(b.type, b.data as BlockData) })),
		[canvas.data],
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [slot, setSlot] = useState<HookSlot>("onBefore");
	const errors = hookErrors(hooks);

	const selected = blocks.find((b) => b.id === selectedId) ?? blocks[0];
	if (canvas.isLoading) return <Spinner size="sm" />;
	if (!selected) {
		return <p className="text-xs text-muted">This route has no blocks that can be hooked.</p>;
	}

	const slots = slotsFor(hookSupport(selected.type));
	const current = slots.find((s) => s.slot === slot) ?? slots[0];
	const hook = hooks.find((h) => h.blockId === selected.id);
	const body = hook?.[current.slot] ?? null;

	function setBody(next: HookBody | null) {
		const rest = hooks.filter((h) => h.blockId !== selected.id);
		const updated = { ...hook, blockId: selected.id, [current.slot]: next };
		onChange(updated.onBefore || updated.onAfter ? [...rest, updated] : rest);
	}

	function switchTo(kind: HookBody["kind"] | null) {
		if ((body?.kind ?? null) === kind) return;
		const key = (k: HookBody["kind"]) => `${suiteId}:${selected.id}:${current.slot}:${k}`;
		if (body) unsaved.set(key(body.kind), body.value);
		if (!kind) return setBody(null);
		const fallback = kind === "json" ? "{}" : HOOK_TEMPLATES[current.slot];
		setBody({ kind, value: unsaved.get(key(kind)) ?? fallback });
	}

	return (
		<div className="flex min-h-0 gap-4">
			<div className="flex w-56 shrink-0 flex-col gap-1">
				<Label>Blocks</Label>
				{blocks.map((b) => {
					const hooked = hooks.some((h) => h.blockId === b.id);
					return (
						<button
							key={b.id}
							type="button"
							onClick={() => setSelectedId(b.id)}
							className={cn(tabClass(b.id === selected.id), "flex items-center gap-2 text-left")}
						>
							<span className="min-w-0 flex-1 truncate">
								{b.name}
								{b.custom && <span className="ml-1 text-muted">· {b.definition.name}</span>}
							</span>
							{hooked && (
								<span
									className={cn("text-[10px]", errors.has(b.id) ? "text-danger" : "text-accent")}
								>
									●<span className="sr-only">has hooks</span>
								</span>
							)}
						</button>
					);
				})}
			</div>

			<div className="flex min-w-0 flex-1 flex-col gap-3">
				<div className="flex items-center gap-1">
					{slots.map((s) => (
						<button
							key={s.slot}
							type="button"
							className={tabClass(s.slot === current.slot)}
							onClick={() => setSlot(s.slot)}
						>
							{SLOT_LABELS[s.slot]}
							{hook?.[s.slot] && <span className="ml-1 text-accent">●</span>}
						</button>
					))}
					<span className="mx-2 h-4 w-px bg-border" />
					<button type="button" className={tabClass(!body)} onClick={() => switchTo(null)}>
						Off
					</button>
					<button
						type="button"
						className={tabClass(body?.kind === "script")}
						onClick={() => switchTo("script")}
					>
						Script
					</button>
					{current.json && (
						<button
							type="button"
							className={tabClass(body?.kind === "json")}
							onClick={() => switchTo("json")}
						>
							JSON
						</button>
					)}
				</div>

				<p className="text-xs text-muted">
					{current.slot === "onAfter"
						? "Runs after the block. Return a value to replace its output."
						: current.json
							? "Runs before the block. Return a new input, or call t.skip(output) to skip the block. JSON skips the block and uses the JSON as its output."
							: "Runs before the block. This block runs other steps, so it can't be skipped. Return a new input to steer it."}
				</p>

				{body && (
					// keyed per block and hook: one editor at a time, so the typed globals never clash
					<JavaScriptTextArea
						key={`${selected.id}-${current.slot}-${body.kind}`}
						rows={14}
						language={body.kind === "json" ? "json" : "javascript"}
						value={body.value}
						typeDefinitions={
							body.kind === "script" ? hookTypes(current.slot, selected.type) : undefined
						}
						onChange={(value) => setBody({ ...body, value })}
					/>
				)}
				{errors.has(selected.id) && (
					<p className="text-xs text-danger">{errors.get(selected.id)}</p>
				)}
			</div>
		</div>
	);
}
